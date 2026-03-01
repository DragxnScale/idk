"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  createdAt: string | null;
  sessionCount: number;
  totalMinutes: number;
  lastActiveAt: string | null;
  hasActiveSession?: boolean;
}

interface UserSession {
  id: string;
  goalType: string;
  targetValue: number;
  startedAt: string | null;
  endedAt: string | null;
  totalFocusedMinutes: number;
  lastPageIndex: number | null;
}

interface CatalogEntry {
  id: string;
  title: string;
  edition: string | null;
  isbn: string | null;
  sourceType: string;
  sourceUrl: string | null;
  chapterPageRanges: Record<string, [number, number]>;
  hidden?: boolean;
  visibleToUserIds?: string[];
  createdAt: string | null;
}

type Tab = "users" | "upload" | "catalog";

type UploadStatus = "idle" | "uploading" | "done" | "error";

// ── Helpers ────────────────────────────────────────────────────────────────

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function fmtMinutes(mins: number) {
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  // auth check on first load
  useEffect(() => {
    fetch("/api/admin/users").then((r) => {
      if (r.status === 403) setForbidden(true);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400 animate-pulse">Loading…</p>
      </main>
    );
  }

  if (forbidden) {
    return (
      <main className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-3xl">🚫</p>
          <p className="text-white font-semibold">Access denied</p>
          <p className="text-gray-400 text-sm">This page is restricted to the developer account.</p>
          <Link href="/dashboard" className="text-sm text-gray-500 underline">← Dashboard</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto max-w-6xl px-6 py-10">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold tracking-wide uppercase">Dev</span>
            <h1 className="text-xl font-bold">Developer Panel</h1>
          </div>
          <Link href="/dashboard" className="rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 transition">
            ← Dashboard
          </Link>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-800 mb-6">
          {(["users", "upload", "catalog"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm font-medium capitalize transition rounded-t-lg -mb-px border-b-2 ${
                tab === t
                  ? "border-white text-white"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}
            >
              {t === "upload" ? "Upload to Archive" : t === "catalog" ? "Textbook Catalog" : "Users"}
            </button>
          ))}
        </div>

        {tab === "users" && <UsersTab />}
        {tab === "upload" && <UploadTab />}
        {tab === "catalog" && <CatalogTab />}
      </div>
    </main>
  );
}

// ── Users Tab ──────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [banning, setBanning] = useState<string | null>(null);
  const [confirmBan, setConfirmBan] = useState<UserRow | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [userSessions, setUserSessions] = useState<UserSession[] | null>(null);
  const [deletingSession, setDeletingSession] = useState<string | null>(null);
  const [confirmWipeAll, setConfirmWipeAll] = useState(false);
  const [wipingAll, setWipingAll] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    if (res.ok) setUsers(await res.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  async function banUser(user: UserRow) {
    setBanning(user.id);
    const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
    if (res.ok) {
      setUsers((prev) => prev?.filter((u) => u.id !== user.id) ?? null);
      if (selectedUser?.id === user.id) { setSelectedUser(null); setUserSessions(null); }
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Failed to ban user");
    }
    setBanning(null);
    setConfirmBan(null);
  }

  async function openUserDetail(user: UserRow) {
    setSelectedUser(user);
    setUserSessions(null);
    const res = await fetch(`/api/admin/users/${user.id}`);
    if (res.ok) {
      const data = await res.json();
      setUserSessions(data.sessions);
    }
  }

  async function deleteSession(sessionId: string) {
    if (!selectedUser) return;
    setDeletingSession(sessionId);
    const res = await fetch(`/api/admin/users/${selectedUser.id}?sessionId=${sessionId}`, { method: "DELETE" });
    if (res.ok) {
      setUserSessions((prev) => prev?.filter((s) => s.id !== sessionId) ?? null);
      setUsers((prev) => prev?.map((u) => u.id === selectedUser.id ? { ...u, sessionCount: Math.max(0, u.sessionCount - 1) } : u) ?? null);
    }
    setDeletingSession(null);
  }

  async function wipeAllSessions() {
    if (!selectedUser) return;
    setWipingAll(true);
    const res = await fetch(`/api/admin/users/${selectedUser.id}?action=wipe-all-sessions`);
    if (res.ok) {
      setUserSessions([]);
      setUsers((prev) => prev?.map((u) => u.id === selectedUser.id ? { ...u, sessionCount: 0, totalMinutes: 0 } : u) ?? null);
    }
    setWipingAll(false);
    setConfirmWipeAll(false);
  }

  const filtered = (users ?? []).filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const totalSessions = users?.reduce((s, u) => s + u.sessionCount, 0) ?? 0;
  const totalMins = users?.reduce((s, u) => s + u.totalMinutes, 0) ?? 0;

  // User detail view
  if (selectedUser) {
    return (
      <>
        <button onClick={() => { setSelectedUser(null); setUserSessions(null); }} className="text-sm underline underline-offset-4 text-gray-400 hover:text-white mb-4">
          ← Back to all users
        </button>

        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 mb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold text-lg">{selectedUser.name ?? <span className="text-gray-500 italic">No name</span>}</p>
              <p className="text-sm text-gray-400">{selectedUser.email}</p>
              <div className="flex gap-4 mt-2 text-xs text-gray-500">
                <span>{selectedUser.sessionCount} sessions</span>
                <span>{fmtMinutes(selectedUser.totalMinutes)} total</span>
                <span>Joined {selectedUser.createdAt ? new Date(selectedUser.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}</span>
                {selectedUser.hasActiveSession && <span className="text-amber-400 font-medium">Active session</span>}
              </div>
            </div>
            <button
              onClick={() => setConfirmBan(selectedUser)}
              className="rounded-md border border-red-800 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 transition"
            >
              Ban user
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Study Sessions</h3>
          {userSessions && userSessions.length > 0 && (
            <button
              onClick={() => setConfirmWipeAll(true)}
              className="rounded-md border border-red-800 px-3 py-1 text-xs text-red-400 hover:bg-red-900/30 transition"
            >
              Wipe all sessions
            </button>
          )}
        </div>

        {!userSessions ? (
          <p className="text-sm text-gray-500 animate-pulse">Loading sessions…</p>
        ) : userSessions.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">No sessions found.</p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {userSessions.map((s) => (
              <div key={s.id} className="rounded-lg border border-gray-800 bg-gray-950 p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">
                      {s.goalType === "time" ? `${s.targetValue} min goal` : `${s.targetValue} chapter${s.targetValue !== 1 ? "s" : ""}`}
                    </p>
                    {!s.endedAt && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-400 font-medium">Active</span>}
                  </div>
                  <div className="flex gap-3 text-xs text-gray-500 mt-0.5">
                    <span>{s.totalFocusedMinutes}m studied</span>
                    <span>{s.startedAt ? new Date(s.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                    {s.endedAt ? (
                      <span className="text-green-500">Completed</span>
                    ) : (
                      <span className="text-amber-400">In progress</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => deleteSession(s.id)}
                  disabled={deletingSession === s.id}
                  className="flex-shrink-0 rounded-md border border-red-800 px-3 py-1 text-xs text-red-400 hover:bg-red-900/30 transition disabled:opacity-40"
                >
                  {deletingSession === s.id ? "…" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}

        {confirmWipeAll && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-700 p-6 shadow-2xl">
              <h2 className="text-base font-semibold mb-1">Wipe all sessions?</h2>
              <p className="text-sm text-gray-400 mb-1">User: <span className="text-white font-medium">{selectedUser.email}</span></p>
              <p className="text-sm text-gray-500 mb-5">This will permanently delete all {userSessions?.length ?? 0} study sessions for this user. Cannot be undone.</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmWipeAll(false)} className="flex-1 rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 transition">Cancel</button>
                <button onClick={wipeAllSessions} disabled={wipingAll} className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium hover:bg-red-700 transition disabled:opacity-50">
                  {wipingAll ? "Wiping…" : "Yes, wipe all"}
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmBan && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-700 p-6 shadow-2xl">
              <h2 className="text-base font-semibold mb-1">Ban this user?</h2>
              <p className="text-sm text-gray-400 mb-1"><span className="text-white font-medium">{confirmBan.email}</span></p>
              <p className="text-sm text-gray-500 mb-5">This will permanently delete their account, sessions, notes, and quiz data. Cannot be undone.</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmBan(null)} className="flex-1 rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 transition">Cancel</button>
                <button onClick={() => banUser(confirmBan)} disabled={banning === confirmBan.id} className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium hover:bg-red-700 transition disabled:opacity-50">
                  {banning === confirmBan.id ? "Banning…" : "Yes, ban them"}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {[
          { label: "Total Accounts", value: users?.length ?? "—" },
          { label: "Total Sessions", value: totalSessions },
          { label: "Total Study Time", value: fmtMinutes(totalMins) },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-center">
            <p className="text-xl font-bold">{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <input
        type="text"
        placeholder="Search by email or name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full mb-4 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:border-gray-500"
      />

      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 border-b border-gray-800">
            <tr>
              {["User", "Joined", "Sessions", "Study Time", "Last Active", ""].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No users found.</td></tr>
            )}
            {filtered.map((user) => (
              <tr key={user.id} className="bg-gray-950 hover:bg-gray-900 transition">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div>
                      <p className="font-medium">{user.name ?? <span className="text-gray-500 italic">No name</span>}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{user.email}</p>
                    </div>
                    {user.hasActiveSession && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-400 font-medium">Active</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-400">
                  {user.createdAt ? new Date(user.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}
                </td>
                <td className="px-4 py-3 text-gray-300">{user.sessionCount}</td>
                <td className="px-4 py-3 text-gray-300">{fmtMinutes(user.totalMinutes)}</td>
                <td className="px-4 py-3 text-gray-400">
                  {user.lastActiveAt ? new Date(user.lastActiveAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Never"}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => openUserDetail(user)}
                      className="rounded-md border border-gray-600 px-3 py-1 text-xs text-gray-400 hover:bg-gray-800 transition"
                    >
                      Manage
                    </button>
                    <button
                      onClick={() => setConfirmBan(user)}
                      disabled={banning === user.id}
                      className="rounded-md border border-red-800 px-3 py-1 text-xs text-red-400 hover:bg-red-900/30 transition disabled:opacity-40"
                    >
                      Ban
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-600 text-center">Banning permanently deletes all account data.</p>

      {confirmBan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-700 p-6 shadow-2xl">
            <h2 className="text-base font-semibold mb-1">Ban this user?</h2>
            <p className="text-sm text-gray-400 mb-1"><span className="text-white font-medium">{confirmBan.email}</span></p>
            <p className="text-sm text-gray-500 mb-5">This will permanently delete their account, sessions, notes, and quiz data. Cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmBan(null)} className="flex-1 rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 transition">Cancel</button>
              <button onClick={() => banUser(confirmBan)} disabled={banning === confirmBan.id} className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium hover:bg-red-700 transition disabled:opacity-50">
                {banning === confirmBan.id ? "Banning…" : "Yes, ban them"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Upload Tab ─────────────────────────────────────────────────────────────

function UploadTab() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [edition, setEdition] = useState("");
  const [isbn, setIsbn] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [addToCatalog, setAddToCatalog] = useState(true);
  const [chaptersJson, setChaptersJson] = useState('{\n  "1": [1, 50],\n  "2": [51, 100]\n}');

  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [statusLabel, setStatusLabel] = useState("");
  const [archiveUrl, setArchiveUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const addLog = (msg: string) => setDebugLog((prev) => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`]);

  // Auto-generate identifier from title
  useEffect(() => {
    if (title) setIdentifier(`studyfocus-${slugify(title)}`);
  }, [title]);

  async function handleUpload() {
    if (!file || !title || !identifier) {
      setError("Please fill in Title and select a PDF file.");
      return;
    }

    let parsedChapters: Record<string, [number, number]> | null = null;
    if (addToCatalog) {
      try {
        parsedChapters = JSON.parse(chaptersJson);
      } catch {
        setError("Chapter page ranges is not valid JSON. Fix it before uploading.");
        return;
      }
    }

    setStatus("uploading");
    setError(null);
    setProgress(0);
    setDebugLog([]);

    const filename = file.name.replace(/\s+/g, "_");
    const blobPathname = `admin-staging/${identifier}/${filename}`;

    // Step 1: Upload PDF directly from browser to Vercel Blob CDN.
    // The upload() SDK sends the file browser→CDN, bypassing all functions.
    // Our /api/admin/blob-token endpoint generates the token and short-circuits
    // the completion callback with an immediate 200.
    setStatusLabel("Uploading to storage…");
    addLog(`Starting upload: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
    addLog(`Pathname: ${blobPathname}`);
    let blobUrl: string;
    try {
      // Step 1a: Request a client token from our server.
      addLog("Requesting client token…");
      const tokenRes = await fetch("/api/admin/blob-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "blob.generate-client-token",
          payload: { pathname: blobPathname, clientPayload: null, multipart: true },
        }),
      });
      addLog(`Token response: ${tokenRes.status}`);
      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        addLog(`Token error: ${errBody}`);
        throw new Error(`Token failed (${tokenRes.status}): ${errBody}`);
      }
      const tokenData = await tokenRes.json();
      if (!tokenData.clientToken) {
        throw new Error("No clientToken in response");
      }
      const clientToken = tokenData.clientToken;
      addLog(`Got token (${clientToken.length} chars)`);

      // Step 1b: Upload directly to Vercel Blob API via XHR.
      // No SDK — raw XHR for full control and visibility.
      const params = new URLSearchParams({ pathname: blobPathname });
      const apiUrl = `https://vercel.com/api/blob/?${params.toString()}`;
      addLog(`Uploading to Vercel Blob…`);

      const uploadResult = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", apiUrl);
        xhr.setRequestHeader("authorization", `Bearer ${clientToken}`);
        xhr.setRequestHeader("x-api-version", "7");
        xhr.setRequestHeader("x-content-type", "application/pdf");
        xhr.setRequestHeader("x-vercel-blob-access", "public");
        xhr.setRequestHeader("x-api-blob-request-attempt", "0");

        let lastLoggedPct = -1;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setProgress(Math.round(pct * 0.7));
            const bucket = Math.floor(pct / 10) * 10;
            if (bucket > lastLoggedPct) {
              lastLoggedPct = bucket;
              addLog(`Upload: ${pct}% (${(e.loaded / 1024 / 1024).toFixed(0)}/${(e.total / 1024 / 1024).toFixed(0)} MB)`);
            }
          }
        };

        xhr.onload = () => {
          addLog(`XHR response: ${xhr.status} ${xhr.statusText}`);
          addLog(`XHR body: ${xhr.responseText.slice(0, 500)}`);
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const res = JSON.parse(xhr.responseText);
              resolve(res.url);
            } catch {
              reject(new Error(`Invalid JSON: ${xhr.responseText.slice(0, 200)}`));
            }
          } else {
            reject(new Error(`Upload failed: ${xhr.status} ${xhr.responseText.slice(0, 300)}`));
          }
        };

        xhr.onerror = () => {
          // CORS blocks reading the response, but the data IS uploaded.
          // We'll look up the blob URL server-side instead.
          addLog("XHR finished (CORS blocks response — expected)");
          resolve("__cors_blocked__");
        };

        xhr.onabort = () => reject(new Error("Upload cancelled"));

        xhr.ontimeout = () => {
          addLog("XHR timeout");
          reject(new Error("Upload timed out"));
        };

        addLog("Sending file via XHR PUT…");
        xhr.send(file);
      });

      // If CORS blocked the response, look up the blob URL server-side.
      if (uploadResult === "__cors_blocked__") {
        addLog("Looking up blob URL from server…");
        const lookupRes = await fetch(
          `/api/admin/blob-lookup?prefix=${encodeURIComponent(blobPathname)}`
        );
        addLog(`Lookup response: ${lookupRes.status}`);
        if (!lookupRes.ok) {
          const err = await lookupRes.text();
          addLog(`Lookup error: ${err}`);
          throw new Error(`Blob lookup failed: ${err}`);
        }
        const lookupData = await lookupRes.json();
        blobUrl = lookupData.url;
        addLog(`Found blob URL: ${blobUrl}`);
      } else {
        blobUrl = uploadResult;
        addLog(`Upload complete! URL: ${blobUrl}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload to storage failed";
      addLog(`UPLOAD ERROR: ${msg}`);
      if (e instanceof Error && e.stack) addLog(`Stack: ${e.stack.split("\n").slice(0, 3).join(" | ")}`);
      setError(msg);
      setStatus("error");
      return;
    }

    // Step 2: Server fetches from Vercel Blob and streams to archive.org (server-to-server)
    setStatusLabel("Transferring to Archive.org…");
    setProgress(75);
    const archiveRes = await fetch("/api/admin/archive-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blobUrl, identifier, filename, title, edition, isbn }),
    });

    if (!archiveRes.ok) {
      const data = await archiveRes.json().catch(() => ({}));
      setError(data.error ?? `Archive.org transfer failed (${archiveRes.status})`);
      setStatus("error");
      return;
    }

    setProgress(95);
    const publicUrl = `https://archive.org/download/${identifier}/${filename}`;
    setArchiveUrl(publicUrl);

    if (addToCatalog && parsedChapters) {
      const catalogRes = await fetch("/api/admin/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: identifier,
          title,
          edition: edition || null,
          isbn: isbn || null,
          sourceType: "oer",
          sourceUrl: publicUrl,
          chapterPageRanges: parsedChapters,
        }),
      });
      if (!catalogRes.ok) {
        setError("Uploaded to archive.org but failed to add to textbook catalog.");
        setStatus("error");
        return;
      }
    }

    setStatus("done");
    setProgress(100);
  }

  function reset() {
    setFile(null);
    setTitle("");
    setEdition("");
    setIsbn("");
    setIdentifier("");
    setStatus("idle");
    setProgress(0);
    setArchiveUrl(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-gray-400 mb-6">
        Upload a PDF to your Archive.org account and optionally add it to the public textbook catalog.
        Upload a PDF directly to cloud storage, then transfer to Archive.org. No size limits.
      </p>

      {status === "done" ? (
        <div className="rounded-xl border border-green-700 bg-green-900/20 p-6 space-y-3">
          <p className="text-green-400 font-semibold text-base">Upload complete!</p>
          <p className="text-sm text-gray-300">Your file is now live on Archive.org:</p>
          <a href={archiveUrl!} target="_blank" rel="noopener noreferrer" className="block text-sm text-blue-400 underline break-all">{archiveUrl}</a>
          {addToCatalog && <p className="text-sm text-gray-400">Also added to the textbook catalog — users can now find it in the document picker.</p>}
          <button onClick={reset} className="mt-2 rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 transition">Upload another</button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* File picker */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">PDF File *</label>
            <div
              onClick={() => fileRef.current?.click()}
              className="cursor-pointer rounded-xl border-2 border-dashed border-gray-700 hover:border-gray-500 transition p-6 text-center"
            >
              {file ? (
                <div>
                  <p className="text-sm font-medium text-white">{file.name}</p>
                  <p className="text-xs text-gray-500 mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-400">Click to select a PDF file</p>
                  <p className="text-xs text-gray-600 mt-1">Any size — uploaded directly to cloud storage</p>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title) setTitle(f.name.replace(/\.pdf$/i, "").replace(/[-_]/g, " "));
              }}
            />
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">Title *</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Chemistry (Zumdahl) 8th Edition"
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">Edition</label>
              <input
                type="text"
                value={edition}
                onChange={(e) => setEdition(e.target.value)}
                placeholder="e.g. 8th"
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">ISBN</label>
              <input
                type="text"
                value={isbn}
                onChange={(e) => setIsbn(e.target.value)}
                placeholder="e.g. 978-0-618-52844-8"
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">Archive.org Identifier *</label>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="auto-generated from title"
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500 font-mono"
              />
              <p className="text-xs text-gray-600 mt-1">Must be unique on archive.org. Auto-generated but you can edit it.</p>
            </div>
          </div>

          {/* Catalog option */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={addToCatalog}
                onChange={(e) => setAddToCatalog(e.target.checked)}
                className="rounded accent-white w-4 h-4"
              />
              <div>
                <p className="text-sm font-medium">Add to textbook catalog after upload</p>
                <p className="text-xs text-gray-500">Makes it available in the document picker for all users</p>
              </div>
            </label>

            {addToCatalog && (
              <div className="mt-4">
                <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">Chapter Page Ranges (JSON)</label>
                <textarea
                  value={chaptersJson}
                  onChange={(e) => setChaptersJson(e.target.value)}
                  rows={8}
                  spellCheck={false}
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-y"
                />
                <p className="text-xs text-gray-600 mt-1">
                  Format: <code className="bg-gray-800 px-1 rounded">{`{ "1": [startPage, endPage], "2": [...] }`}</code> — use 1-based PDF page numbers.
                </p>
              </div>
            )}
          </div>

          {/* Progress */}
          {status === "uploading" && (
            <div>
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>{statusLabel || "Uploading…"}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
                <div
                  className="h-full bg-white rounded-full transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-400 rounded-lg border border-red-800 bg-red-900/20 px-4 py-3">{error}</p>
          )}

          {debugLog.length > 0 && (
            <details open className="rounded-lg border border-gray-800 bg-gray-950 px-4 py-3">
              <summary className="text-xs text-gray-500 cursor-pointer select-none">Debug log ({debugLog.length} entries)</summary>
              <pre className="mt-2 text-xs text-gray-400 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                {debugLog.join("\n")}
              </pre>
            </details>
          )}

          <button
            onClick={handleUpload}
            disabled={status === "uploading" || !file || !title || !identifier}
            className="w-full rounded-lg bg-white text-black py-2.5 text-sm font-semibold hover:bg-gray-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {status === "uploading" ? `${statusLabel || "Uploading…"} ${progress}%` : "Upload to Archive.org"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Catalog Tab ────────────────────────────────────────────────────────────

function CatalogTab() {
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CatalogEntry | null>(null);
  const [confirmHide, setConfirmHide] = useState<CatalogEntry | null>(null);
  const [hideUserIds, setHideUserIds] = useState<string[]>([]);
  const [usersForHide, setUsersForHide] = useState<UserRow[]>([]);
  const [patching, setPatching] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/catalog");
    if (res.ok) setEntries(await res.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  async function deleteEntry(entry: CatalogEntry) {
    setDeleting(entry.id);
    const res = await fetch(`/api/admin/catalog?id=${entry.id}`, { method: "DELETE" });
    if (res.ok) setEntries((prev) => prev?.filter((e) => e.id !== entry.id) ?? null);
    else alert("Failed to remove entry");
    setDeleting(null);
    setConfirmDelete(null);
  }

  async function openHideModal(entry: CatalogEntry) {
    setConfirmHide(entry);
    setHideUserIds(entry.visibleToUserIds ?? []);
    const res = await fetch("/api/admin/users");
    if (res.ok) setUsersForHide(await res.json());
    else setUsersForHide([]);
  }

  async function applyHide() {
    if (!confirmHide) return;
    setPatching(confirmHide.id);
    const res = await fetch("/api/admin/catalog", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: confirmHide.id,
        hidden: true,
        visibleToUserIds: hideUserIds,
      }),
    });
    if (res.ok) {
      setEntries((prev) =>
        prev?.map((e) =>
          e.id === confirmHide.id
            ? { ...e, hidden: true, visibleToUserIds: hideUserIds }
            : e
        ) ?? null
      );
      setConfirmHide(null);
    } else alert("Failed to update");
    setPatching(null);
  }

  async function unhideEntry(entry: CatalogEntry) {
    setPatching(entry.id);
    const res = await fetch("/api/admin/catalog", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entry.id, hidden: false, visibleToUserIds: [] }),
    });
    if (res.ok) {
      setEntries((prev) =>
        prev?.map((e) =>
          e.id === entry.id ? { ...e, hidden: false, visibleToUserIds: [] } : e
        ) ?? null
      );
    } else alert("Failed to unhide");
    setPatching(null);
  }

  function toggleHideUser(userId: string) {
    setHideUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  const filtered = (entries ?? []).filter(
    (e) =>
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      (e.id ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">{entries?.length ?? 0} entries in the public catalog</p>
        <button onClick={load} className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs hover:bg-gray-800 transition">Refresh</button>
      </div>

      <input
        type="text"
        placeholder="Search by title or ID…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full mb-4 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm placeholder-gray-500 focus:outline-none focus:border-gray-500"
      />

      <div className="space-y-3">
        {filtered.length === 0 && (
          <p className="text-center text-gray-500 py-8 text-sm">No catalog entries found.</p>
        )}
        {filtered.map((entry) => {
          const chapterCount = Object.keys(entry.chapterPageRanges).length;
          return (
            <div key={entry.id} className="rounded-xl border border-gray-800 bg-gray-900 p-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm">{entry.title}</p>
                  {entry.edition && <span className="text-xs text-gray-500">{entry.edition} ed.</span>}
                  {entry.hidden && (
                    <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-amber-900/50 text-amber-400">
                      Hidden
                    </span>
                  )}
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${entry.sourceType === "oer" ? "bg-green-900/50 text-green-400" : "bg-gray-800 text-gray-400"}`}>
                    {entry.sourceType}
                  </span>
                </div>
                <p className="text-xs text-gray-600 font-mono mt-0.5">{entry.id}</p>
                {entry.isbn && <p className="text-xs text-gray-500 mt-0.5">ISBN: {entry.isbn}</p>}
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-xs text-gray-500">{chapterCount} chapter{chapterCount !== 1 ? "s" : ""}</span>
                  {entry.sourceUrl && (
                    <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:text-blue-400 underline truncate max-w-xs">
                      {entry.sourceUrl}
                    </a>
                  )}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {entry.hidden ? (
                  <button
                    onClick={() => unhideEntry(entry)}
                    disabled={patching === entry.id}
                    className="rounded-md border border-amber-700 px-3 py-1 text-xs text-amber-400 hover:bg-amber-900/30 transition disabled:opacity-40"
                  >
                    {patching === entry.id ? "…" : "Unhide"}
                  </button>
                ) : (
                  <button
                    onClick={() => openHideModal(entry)}
                    disabled={patching === entry.id}
                    className="rounded-md border border-gray-600 px-3 py-1 text-xs text-gray-400 hover:bg-gray-800 transition disabled:opacity-40"
                  >
                    Hide
                  </button>
                )}
                <button
                  onClick={() => setConfirmDelete(entry)}
                  disabled={deleting === entry.id}
                  className="rounded-md border border-red-800 px-3 py-1 text-xs text-red-400 hover:bg-red-900/30 transition disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-700 p-6 shadow-2xl">
            <h2 className="text-base font-semibold mb-1">Remove from catalog?</h2>
            <p className="text-sm text-gray-400 mb-1"><span className="text-white font-medium">{confirmDelete.title}</span></p>
            <p className="text-sm text-gray-500 mb-5">This removes it from the public catalog. The archive.org file will not be deleted.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 transition">Cancel</button>
              <button onClick={() => deleteEntry(confirmDelete)} disabled={deleting === confirmDelete.id} className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium hover:bg-red-700 transition disabled:opacity-50">
                {deleting === confirmDelete.id ? "Removing…" : "Yes, remove"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmHide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-gray-900 border border-gray-700 p-6 shadow-2xl max-h-[85vh] flex flex-col">
            <h2 className="text-base font-semibold mb-1">Hide from public catalog</h2>
            <p className="text-sm text-gray-400 mb-2"><span className="text-white font-medium">{confirmHide.title}</span></p>
            <p className="text-sm text-gray-500 mb-3">The book will not appear in the catalog for most users. Select who can still see it:</p>
            <div className="flex-1 overflow-y-auto rounded-lg border border-gray-700 bg-gray-950 p-2 mb-4 min-h-0">
              {usersForHide.length === 0 ? (
                <p className="text-xs text-gray-500 py-2">Loading users…</p>
              ) : (
                <ul className="space-y-1">
                  {usersForHide.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-800/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hideUserIds.includes(u.id)}
                        onChange={() => toggleHideUser(u.id)}
                        className="rounded border-gray-600"
                      />
                      <span className="text-sm text-gray-300">{u.email}</span>
                      {u.name && <span className="text-xs text-gray-500">({u.name})</span>}
                    </label>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setConfirmHide(null); setHideUserIds([]); }} className="flex-1 rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 transition">Cancel</button>
              <button onClick={applyHide} disabled={patching === confirmHide.id} className="flex-1 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium hover:bg-amber-700 transition disabled:opacity-50">
                {patching === confirmHide.id ? "Saving…" : "Hide"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
