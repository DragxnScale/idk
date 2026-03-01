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
}

interface CatalogEntry {
  id: string;
  title: string;
  edition: string | null;
  isbn: string | null;
  sourceType: string;
  sourceUrl: string | null;
  chapterPageRanges: Record<string, [number, number]>;
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
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Failed to ban user");
    }
    setBanning(null);
    setConfirmBan(null);
  }

  const filtered = (users ?? []).filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const totalSessions = users?.reduce((s, u) => s + u.sessionCount, 0) ?? 0;
  const totalMins = users?.reduce((s, u) => s + u.totalMinutes, 0) ?? 0;

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
                  <p className="font-medium">{user.name ?? <span className="text-gray-500 italic">No name</span>}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{user.email}</p>
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
                  <button
                    onClick={() => setConfirmBan(user)}
                    disabled={banning === user.id}
                    className="rounded-md border border-red-800 px-3 py-1 text-xs text-red-400 hover:bg-red-900/30 transition disabled:opacity-40"
                  >
                    Ban
                  </button>
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
  const xhrRef = useRef<XMLHttpRequest | null>(null);
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

    const filename = encodeURIComponent(file.name.replace(/\s+/g, "_"));

    // Step 1: Stream PDF to Vercel Blob via an Edge Function route
    // Edge runtime has no body size limit, so any size PDF works.
    setStatusLabel("Uploading to storage…");
    let blobUrl: string;
    try {
      blobUrl = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open("POST", `/api/admin/blob-stream?pathname=admin-staging/${identifier}/${filename}`);
        xhr.setRequestHeader("Content-Type", "application/pdf");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(prev => Math.max(prev, Math.round((e.loaded / e.total) * 70)));
        };
        xhr.onload = () => {
          xhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const result = JSON.parse(xhr.responseText);
              resolve(result.url);
            } catch {
              reject(new Error("Invalid response from storage"));
            }
          } else {
            const msg = (() => { try { return JSON.parse(xhr.responseText).error; } catch { return null; } })();
            reject(new Error(msg ?? `Storage returned ${xhr.status}`));
          }
        };
        xhr.onerror = () => { xhrRef.current = null; reject(new Error("Network error during upload")); };
        xhr.onabort = () => { xhrRef.current = null; reject(new Error("Upload cancelled")); };
        xhr.send(file);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload to storage failed");
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
    xhrRef.current?.abort();
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
        Files are streamed through the server — no size limits, no CORS issues.
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
                  <p className="text-xs text-gray-600 mt-1">Any size — streamed through the server</p>
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
              <button
                onClick={() => setConfirmDelete(entry)}
                disabled={deleting === entry.id}
                className="flex-shrink-0 rounded-md border border-red-800 px-3 py-1 text-xs text-red-400 hover:bg-red-900/30 transition disabled:opacity-40"
              >
                Remove
              </button>
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
    </>
  );
}
