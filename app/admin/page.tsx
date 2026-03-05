"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createMultipartUploader } from "@vercel/blob/client";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
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
  pagesVisited: number;
  documentJson: string | null;
}

interface PageVisit {
  id: string;
  pageNumber: number;
  enteredAt: string | null;
  leftAt: string | null;
  durationSeconds: number | null;
}

interface SessionDetail {
  session: UserSession;
  document: {
    title?: string;
    chapterPageRanges?: Record<string, [number, number]>;
    selectedChapters?: string[];
  };
  pageVisits: PageVisit[];
}

interface CatalogEntry {
  id: string;
  title: string;
  edition: string | null;
  isbn: string | null;
  sourceType: string;
  sourceUrl: string | null;
  chapterPageRanges: Record<string, [number, number]>;
  pageOffset: number;
  hidden?: boolean;
  visibleToUserIds?: string[];
  createdAt: string | null;
}

interface TocRow {
  label: string;
  startPage: number;
  endPage: number;
}

type Tab = "users" | "upload" | "catalog" | "messages" | "storage";

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

function fmtSeconds(sec: number) {
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ${sec % 60}s`;
  if (sec >= 60) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${sec}s`;
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
    <main className="min-h-screen bg-gray-950 text-white overflow-x-hidden">
      <div className="mx-auto max-w-6xl px-6 py-10">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold tracking-wide uppercase">Dev</span>
            <h1 className="text-xl font-bold">Developer Panel</h1>
            <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-[10px] font-mono text-gray-400 border border-gray-700">
              v{process.env.NEXT_PUBLIC_APP_VERSION ?? "1.00"}
            </span>
          </div>
          <Link href="/dashboard" className="rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 transition">
            ← Dashboard
          </Link>
        </div>

        {/* Tabs */}
        <div className="overflow-x-auto -mx-6 px-6">
          <div className="flex gap-1 border-b border-gray-800 mb-6 min-w-max">
            {(["users", "upload", "catalog", "messages", "storage"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-2.5 text-sm font-medium capitalize transition rounded-t-lg -mb-px border-b-2 whitespace-nowrap ${
                  tab === t
                    ? "border-white text-white"
                    : "border-transparent text-gray-500 hover:text-gray-300"
                }`}
              >
                {t === "upload" ? "Upload to Archive" : t === "catalog" ? "Textbook Catalog" : t === "messages" ? "Messages" : t === "storage" ? "Blob Storage" : "Users"}
              </button>
            ))}
          </div>
        </div>

        {tab === "users" && <UsersTab />}
        {tab === "upload" && <UploadTab />}
        {tab === "catalog" && <CatalogTab />}
        {tab === "messages" && <MessagesTab />}
        {tab === "storage" && <StorageTab />}
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
  const [userInactivityTimeout, setUserInactivityTimeout] = useState<string>("");
  const [savingInactivity, setSavingInactivity] = useState(false);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [togglingAdmin, setTogglingAdmin] = useState<string | null>(null);

  async function toggleAdmin(user: UserRow) {
    setTogglingAdmin(user.id);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, isAdmin: !user.isAdmin }),
      });
      if (res.ok) {
        setUsers((prev) => prev?.map((u) => u.id === user.id ? { ...u, isAdmin: !u.isAdmin } : u) ?? null);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed to update admin role");
      }
    } finally {
      setTogglingAdmin(null);
    }
  }

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
    setUserInactivityTimeout("");
    const res = await fetch(`/api/admin/users/${user.id}`);
    if (res.ok) {
      const data = await res.json();
      setUserSessions(data.sessions);
      if (data.user?.inactivityTimeout != null) {
        setUserInactivityTimeout(String(data.user.inactivityTimeout));
      }
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

  async function openSessionDetail(sessionId: string) {
    if (!selectedUser) return;
    setLoadingDetail(true);
    setSessionDetail(null);
    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}/sessions/${sessionId}`);
      if (res.ok) {
        setSessionDetail(await res.json());
      }
    } finally {
      setLoadingDetail(false);
    }
  }

  const filtered = (users ?? []).filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const totalSessions = users?.reduce((s, u) => s + u.sessionCount, 0) ?? 0;
  const totalMins = users?.reduce((s, u) => s + u.totalMinutes, 0) ?? 0;

  // Session detail loading state
  if (selectedUser && loadingDetail) {
    return (
      <>
        <button onClick={() => { setLoadingDetail(false); setSessionDetail(null); }} className="text-sm underline underline-offset-4 text-gray-400 hover:text-white mb-4">
          ← Back to {selectedUser.name ?? selectedUser.email}
        </button>
        <div className="flex items-center justify-center py-20">
          <p className="text-gray-400 animate-pulse">Loading session details…</p>
        </div>
      </>
    );
  }

  // Session detail view
  if (selectedUser && sessionDetail) {
    const { session: sd, document: doc, pageVisits: visits } = sessionDetail;

    // Aggregate time per page
    const pageTimeMap = new Map<number, number>();
    const pageVisitCount = new Map<number, number>();
    for (const v of visits) {
      const dur = v.durationSeconds ?? 0;
      pageTimeMap.set(v.pageNumber, (pageTimeMap.get(v.pageNumber) ?? 0) + dur);
      pageVisitCount.set(v.pageNumber, (pageVisitCount.get(v.pageNumber) ?? 0) + 1);
    }
    const uniquePages = Array.from(new Set(visits.map((v) => v.pageNumber))).sort((a, b) => a - b);
    const totalTrackedSeconds = Array.from(pageTimeMap.values()).reduce((a, b) => a + b, 0);

    const getChapterForPage = (page: number): string | null => {
      if (!doc.chapterPageRanges) return null;
      for (const [ch, [start, end]] of Object.entries(doc.chapterPageRanges)) {
        if (page >= start && page <= end) return ch;
      }
      return null;
    };

    return (
      <>
        <button onClick={() => setSessionDetail(null)} className="text-sm underline underline-offset-4 text-gray-400 hover:text-white mb-4">
          ← Back to {selectedUser.name ?? selectedUser.email}
        </button>

        {/* Session overview card */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 mb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold text-lg">{doc.title ?? "Study Session"}</p>
              <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-400">
                <span>{sd.goalType === "time" ? `${sd.targetValue} min goal` : `${sd.targetValue} chapter${sd.targetValue !== 1 ? "s" : ""}`}</span>
                <span>{sd.totalFocusedMinutes}m focused</span>
                <span>{sd.pagesVisited} pages visited</span>
                {sd.startedAt && <span>{new Date(sd.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
                {sd.endedAt ? <span className="text-green-500">Completed</span> : <span className="text-amber-400">In progress</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Selected chapters */}
        {doc.selectedChapters && doc.selectedChapters.length > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 mb-5">
            <h3 className="text-sm font-semibold mb-2">Chapters Selected</h3>
            <div className="flex flex-wrap gap-2">
              {doc.selectedChapters.map((ch) => {
                const range = doc.chapterPageRanges?.[ch];
                return (
                  <span key={ch} className="rounded-full bg-gray-800 border border-gray-700 px-3 py-1 text-xs">
                    {ch}{range ? ` (pp. ${range[0]}–${range[1]})` : ""}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Page-by-page breakdown */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 mb-5">
          <h3 className="text-sm font-semibold mb-1">Page-by-Page Reading Time</h3>
          <p className="text-xs text-gray-500 mb-3">
            {uniquePages.length} unique pages &middot; {fmtSeconds(totalTrackedSeconds)} total tracked time
          </p>

          {visits.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No page visit data recorded for this session.</p>
          ) : (
            <div className="space-y-1 max-h-[50vh] overflow-y-auto pr-1">
              {uniquePages.map((pg) => {
                const dur = pageTimeMap.get(pg) ?? 0;
                const count = pageVisitCount.get(pg) ?? 0;
                const ch = getChapterForPage(pg);
                const maxDur = Math.max(...Array.from(pageTimeMap.values()), 1);
                const barWidth = Math.max(2, (dur / maxDur) * 100);
                return (
                  <div key={pg} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-gray-800/50 transition group">
                    <span className="w-14 text-xs text-gray-400 text-right font-mono flex-shrink-0">p. {pg}</span>
                    {ch && <span className="text-[10px] text-gray-500 w-20 truncate flex-shrink-0" title={ch}>{ch}</span>}
                    <div className="flex-1 min-w-0">
                      <div className="h-4 rounded-full overflow-hidden bg-gray-800">
                        <div className="h-full rounded-full bg-blue-500/70 transition-all" style={{ width: `${barWidth}%` }} />
                      </div>
                    </div>
                    <span className="w-16 text-xs text-gray-400 text-right flex-shrink-0">{fmtSeconds(dur)}</span>
                    {count > 1 && <span className="text-[10px] text-gray-600 flex-shrink-0">×{count}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Visit timeline */}
        {visits.length > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 mb-5">
            <h3 className="text-sm font-semibold mb-2">Visit Timeline</h3>
            <div className="space-y-0.5 max-h-[40vh] overflow-auto pr-1 text-xs font-mono">
              {visits.map((v, i) => {
                const ch = getChapterForPage(v.pageNumber);
                return (
                  <div key={v.id} className="flex items-center gap-3 py-1 px-2 rounded hover:bg-gray-800/30 transition">
                    <span className="text-gray-600 w-6 text-right">{i + 1}</span>
                    <span className="text-gray-400 w-14 text-right">p. {v.pageNumber}</span>
                    {ch && <span className="text-gray-600 w-20 truncate" title={ch}>{ch}</span>}
                    <span className="text-gray-500">
                      {v.enteredAt ? new Date(v.enteredAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
                    </span>
                    <span className="text-gray-600">→</span>
                    <span className="text-gray-500">
                      {v.leftAt ? new Date(v.leftAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
                    </span>
                    <span className="text-gray-400 ml-auto">{v.durationSeconds != null ? fmtSeconds(v.durationSeconds) : "—"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </>
    );
  }

  // User detail view
  if (selectedUser) {
    return (
      <>
        <button onClick={() => { setSelectedUser(null); setUserSessions(null); setSessionDetail(null); }} className="text-sm underline underline-offset-4 text-gray-400 hover:text-white mb-4">
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

        {/* Inactivity timeout override */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 mb-5">
          <h3 className="text-sm font-semibold mb-2">Inactivity timeout override</h3>
          <p className="text-xs text-gray-500 mb-3">
            Override how long before the &quot;Are you still reading?&quot; prompt appears. Leave blank to reset to user&apos;s own setting.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={60}
              value={userInactivityTimeout}
              onChange={(e) => setUserInactivityTimeout(e.target.value)}
              placeholder="e.g. 3"
              className="w-24 rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm"
            />
            <span className="text-xs text-gray-500">min</span>
            <button
              onClick={async () => {
                if (!selectedUser) return;
                setSavingInactivity(true);
                try {
                  await fetch(`/api/admin/users/${selectedUser.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      inactivityTimeout: userInactivityTimeout === "" ? null : Number(userInactivityTimeout),
                    }),
                  });
                } finally {
                  setSavingInactivity(false);
                }
              }}
              disabled={savingInactivity}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
            >
              {savingInactivity ? "Saving…" : "Save"}
            </button>
            {userInactivityTimeout !== "" && (
              <button
                onClick={async () => {
                  if (!selectedUser) return;
                  setUserInactivityTimeout("");
                  setSavingInactivity(true);
                  try {
                    await fetch(`/api/admin/users/${selectedUser.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ inactivityTimeout: null }),
                    });
                  } finally {
                    setSavingInactivity(false);
                  }
                }}
                className="text-xs text-red-400 hover:underline"
              >
                Reset
              </button>
            )}
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
            {userSessions.map((s) => {
              let docTitle: string | null = null;
              if (s.documentJson) {
                try {
                  const parsed = JSON.parse(s.documentJson);
                  docTitle = parsed.title ?? parsed.catalogTitle ?? null;
                } catch {}
              }
              return (
                <div key={s.id} className="rounded-lg border border-gray-800 bg-gray-950 p-3 flex items-center justify-between gap-3">
                  <button
                    onClick={() => openSessionDetail(s.id)}
                    className="min-w-0 text-left flex-1 hover:bg-gray-900/50 rounded-lg -m-1 p-1 transition"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">
                        {docTitle ? docTitle : s.goalType === "time" ? `${s.targetValue} min goal` : `${s.targetValue} chapter${s.targetValue !== 1 ? "s" : ""}`}
                      </p>
                      {!s.endedAt && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-400 font-medium">Active</span>}
                    </div>
                    <div className="flex gap-3 text-xs text-gray-500 mt-0.5">
                      <span>{s.totalFocusedMinutes}m studied</span>
                      {s.pagesVisited > 0 && <span>{s.pagesVisited} pages</span>}
                      <span>{s.startedAt ? new Date(s.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                      {s.endedAt ? (
                        <span className="text-green-500">Completed</span>
                      ) : (
                        <span className="text-amber-400">In progress</span>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-600 mt-1">Click to view details →</p>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                    disabled={deletingSession === s.id}
                    className="flex-shrink-0 rounded-md border border-red-800 px-3 py-1 text-xs text-red-400 hover:bg-red-900/30 transition disabled:opacity-40"
                  >
                    {deletingSession === s.id ? "…" : "Delete"}
                  </button>
                </div>
              );
            })}
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

      <div className="rounded-xl border border-gray-800 overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-gray-900 border-b border-gray-800">
            <tr>
              {["User", "Role", "Joined", "Sessions", "Study Time", "Last Active", ""].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No users found.</td></tr>
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
                <td className="px-4 py-3">
                  {user.isSuperAdmin ? (
                    <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-purple-900/50 text-purple-400">Owner</span>
                  ) : user.isAdmin ? (
                    <button
                      onClick={() => toggleAdmin(user)}
                      disabled={togglingAdmin === user.id}
                      className="text-xs px-1.5 py-0.5 rounded font-medium bg-blue-900/50 text-blue-400 hover:bg-blue-800/50 transition disabled:opacity-40"
                      title="Click to remove admin"
                    >
                      {togglingAdmin === user.id ? "…" : "Admin"}
                    </button>
                  ) : (
                    <button
                      onClick={() => toggleAdmin(user)}
                      disabled={togglingAdmin === user.id}
                      className="text-xs px-1.5 py-0.5 rounded font-medium bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300 transition disabled:opacity-40"
                      title="Click to make admin"
                    >
                      {togglingAdmin === user.id ? "…" : "User"}
                    </button>
                  )}
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

// ── TOC Editor ────────────────────────────────────────────────────────────

function tocRowsToRanges(rows: TocRow[], offset: number): Record<string, [number, number]> {
  const ranges: Record<string, [number, number]> = {};
  for (const row of rows) {
    if (!row.label.trim()) continue;
    ranges[row.label.trim()] = [row.startPage + offset, row.endPage + offset];
  }
  return ranges;
}

function rangesToTocRows(
  ranges: Record<string, [number, number]>,
  offset: number
): TocRow[] {
  return Object.entries(ranges)
    .sort(([, a], [, b]) => a[0] - b[0])
    .map(([label, [start, end]]) => ({
      label,
      startPage: start - offset,
      endPage: end - offset,
    }));
}

function TocEditor({
  rows,
  onChange,
  pageOffset,
  onPageOffsetChange,
}: {
  rows: TocRow[];
  onChange: (rows: TocRow[]) => void;
  pageOffset: number;
  onPageOffsetChange: (n: number) => void;
}) {
  const [showJson, setShowJson] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const endPageRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  useEffect(() => {
    if (focusIdx !== null) {
      const el = endPageRefs.current.get(focusIdx);
      if (el) el.focus();
      setFocusIdx(null);
    }
  }, [focusIdx, rows.length]);

  function updateRow(idx: number, patch: Partial<TocRow>) {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange(next);
  }

  function removeRow(idx: number) {
    endPageRefs.current.delete(idx);
    onChange(rows.filter((_, i) => i !== idx));
  }

  function addRowAfter(idx?: number) {
    const ref = idx !== undefined ? rows[idx] : rows[rows.length - 1];
    const prevEnd = ref?.endPage || 0;
    const nextLabel = String((idx !== undefined ? idx : rows.length) + 2);
    const newRow: TocRow = { label: nextLabel, startPage: prevEnd ? prevEnd + 1 : 0, endPage: 0 };
    if (idx !== undefined) {
      const next = [...rows];
      next.splice(idx + 1, 0, newRow);
      onChange(next);
      setFocusIdx(idx + 1);
    } else {
      onChange([...rows, newRow]);
      setFocusIdx(rows.length);
    }
  }

  function openJsonView() {
    const ranges = tocRowsToRanges(rows, pageOffset);
    setJsonDraft(JSON.stringify(ranges, null, 2));
    setJsonError(null);
    setShowJson(true);
  }

  function applyJson() {
    try {
      const parsed = JSON.parse(jsonDraft);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Must be an object");
      for (const [k, v] of Object.entries(parsed)) {
        if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== "number" || typeof v[1] !== "number") {
          throw new Error(`Invalid range for "${k}"`);
        }
      }
      const newRows = rangesToTocRows(parsed as Record<string, [number, number]>, pageOffset);
      onChange(newRows);
      setShowJson(false);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  return (
    <div className="space-y-3">
      {/* Page offset */}
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">
            Page Offset
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={pageOffset || ""}
            onChange={(e) => onPageOffsetChange(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono focus:outline-none focus:border-gray-500"
          />
          <p className="text-xs text-gray-600 mt-1">
            If the book&apos;s page 1 is on PDF page 15, enter <strong className="text-gray-400">14</strong>.
            Chapter pages below are <em>book</em> pages — the offset converts them to PDF pages automatically.
          </p>
        </div>
      </div>

      {/* Table header */}
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide">
          Chapters ({rows.length})
        </label>
        <button
          type="button"
          onClick={showJson ? () => setShowJson(false) : openJsonView}
          className="text-xs text-gray-500 hover:text-gray-300 underline underline-offset-2 transition"
        >
          {showJson ? "Visual editor" : "Edit as JSON"}
        </button>
      </div>

      {showJson ? (
        <div className="space-y-2">
          <textarea
            value={jsonDraft}
            onChange={(e) => { setJsonDraft(e.target.value); setJsonError(null); }}
            rows={Math.min(20, rows.length * 2 + 4)}
            spellCheck={false}
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-y"
          />
          {jsonError && <p className="text-xs text-red-400">{jsonError}</p>}
          <p className="text-xs text-gray-600">
            JSON uses <strong className="text-gray-400">PDF page numbers</strong> (offset already applied).
          </p>
          <button
            type="button"
            onClick={applyJson}
            className="rounded-lg bg-white text-black px-4 py-1.5 text-xs font-medium hover:bg-gray-200 transition"
          >
            Apply JSON
          </button>
        </div>
      ) : (
        <>
          {rows.length > 0 && (
            <div className="rounded-xl border border-gray-800 overflow-x-auto">
              {/* Column headers */}
              <div className="grid grid-cols-[1fr_90px_90px_36px] gap-2 px-3 py-2 bg-gray-800/50 text-xs text-gray-500 uppercase tracking-wide min-w-[350px]">
                <span>Chapter</span>
                <span>Start pg</span>
                <span>End pg</span>
                <span />
              </div>
              <div className="divide-y divide-gray-800">
                {rows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_90px_90px_36px] gap-2 px-3 py-1.5 items-center min-w-[350px]">
                    <input
                      type="text"
                      value={row.label}
                      onChange={(e) => updateRow(idx, { label: e.target.value })}
                      placeholder="e.g. 1 or Introduction"
                      className="rounded border border-gray-700 bg-gray-950 px-2 py-1 text-sm focus:outline-none focus:border-gray-500"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={row.startPage || ""}
                      onChange={(e) => updateRow(idx, { startPage: parseInt(e.target.value) || 0 })}
                      placeholder="start"
                      className="rounded border border-gray-700 bg-gray-950 px-2 py-1 text-sm font-mono focus:outline-none focus:border-gray-500"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      ref={(el) => { if (el) endPageRefs.current.set(idx, el); else endPageRefs.current.delete(idx); }}
                      value={row.endPage || ""}
                      onChange={(e) => updateRow(idx, { endPage: parseInt(e.target.value) || 0 })}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRowAfter(idx); } }}
                      placeholder="end"
                      className="rounded border border-gray-700 bg-gray-950 px-2 py-1 text-sm font-mono focus:outline-none focus:border-gray-500"
                    />
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      className="rounded p-1 text-gray-600 hover:text-red-400 hover:bg-gray-800 transition"
                      title="Remove chapter"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => addRowAfter()}
            className="w-full rounded-lg border border-dashed border-gray-700 px-4 py-2 text-xs text-gray-400 hover:border-gray-500 hover:text-gray-300 transition"
          >
            + Add chapter
          </button>

          {rows.length > 0 && pageOffset > 0 && (
            <p className="text-xs text-gray-600">
              Preview: Chapter &quot;{rows[0].label}&quot; = PDF pages {rows[0].startPage + pageOffset}–{rows[0].endPage + pageOffset}
            </p>
          )}
        </>
      )}
    </div>
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
  const [tocRows, setTocRows] = useState<TocRow[]>([
    { label: "1", startPage: 1, endPage: 50 },
    { label: "2", startPage: 51, endPage: 100 },
  ]);
  const [pageOffset, setPageOffset] = useState(0);

  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [statusLabel, setStatusLabel] = useState("");
  const [archiveUrl, setArchiveUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const addLog = (msg: string) => setDebugLog((prev) => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`]);

  // Archive.org link paste state
  const [archiveLink, setArchiveLink] = useState("");
  const [archiveLinkError, setArchiveLinkError] = useState<string | null>(null);
  const [archiveDownloading, setArchiveDownloading] = useState(false);

  // Auto-generate identifier from title
  useEffect(() => {
    if (title) setIdentifier(`bowlbeacon-${slugify(title)}`);
  }, [title]);

  async function handleLinkImport() {
    const url = archiveLink.trim();
    if (!url) return;
    setArchiveLinkError(null);

    const archiveMatch = url.match(/archive\.org\/download\/([^/]+)\/([^/?#]+)/);
    if (archiveMatch) {
      if (!identifier) setIdentifier(archiveMatch[1]);
      const archTitle = decodeURIComponent(archiveMatch[2]).replace(/\.pdf$/i, "").replace(/[-_]/g, " ");
      if (archTitle && !title) setTitle(archTitle);
    } else {
      const detailsMatch = url.match(/archive\.org\/details\/([^/?#]+)/);
      if (detailsMatch && !identifier) setIdentifier(detailsMatch[1]);
      const filename = decodeURIComponent(url.split("/").pop() ?? "").replace(/\.pdf$/i, "").replace(/[-_]/g, " ");
      if (filename && !title) setTitle(filename);
    }

    setArchiveDownloading(true);

    try {
      const slug = identifier || `bowlbeacon-${slugify(title || "import")}`;
      const res = await fetch("/api/admin/download-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, identifier: slug }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Download failed");

      setArchiveUrl(data.blobUrl);
      setAddToCatalog(false);
      setProgress(100);
      setStatus("done");
      addLog(`Downloaded & stored: ${data.blobUrl}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Download failed";
      setArchiveLinkError(msg);
    } finally {
      setArchiveDownloading(false);
    }
  }

  async function handleAddToCatalog() {
    if (!archiveUrl || !title) return;
    const slug = identifier || `bowlbeacon-${slugify(title)}`;
    const parsedChapters = tocRowsToRanges(tocRows, pageOffset);

    const catalogRes = await fetch("/api/admin/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: slug,
        title,
        edition: edition || null,
        isbn: isbn || null,
        sourceType: "oer",
        sourceUrl: archiveUrl,
        chapterPageRanges: parsedChapters,
        pageOffset,
      }),
    });
    if (!catalogRes.ok) {
      setError("Failed to add to textbook catalog.");
      return;
    }
    setAddToCatalog(true);
  }

  async function handleUpload() {
    if (!file || !title) {
      setError("Please fill in Title and select a PDF file.");
      return;
    }

    let parsedChapters: Record<string, [number, number]> | null = null;
    if (addToCatalog) {
      parsedChapters = tocRowsToRanges(tocRows, pageOffset);
    }

    setStatus("uploading");
    setError(null);
    setProgress(0);
    setDebugLog([]);

    const filename = file.name.replace(/\s+/g, "_");
    const slug = identifier || `bowlbeacon-${slugify(title)}`;
    const blobPathname = `public/${slug}/${filename}`;

    addLog(`Starting upload: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);

    const PART_SIZE = 8 * 1024 * 1024;
    let blobUrl: string;
    try {
      setStatusLabel("Getting upload token…");
      const tokenRes = await fetch("/api/blob/client-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathname: blobPathname, admin: true }),
      });
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        throw new Error(err.error || `Token request failed (${tokenRes.status})`);
      }
      const { clientToken } = await tokenRes.json();
      addLog("Token received, starting multipart upload…");

      const uploader = await createMultipartUploader(blobPathname, {
        access: "private",
        token: clientToken,
        contentType: "application/pdf",
      });

      const totalParts = Math.ceil(file.size / PART_SIZE);
      const parts: { etag: string; partNumber: number }[] = [];

      for (let i = 0; i < totalParts; i++) {
        const start = i * PART_SIZE;
        const end = Math.min(start + PART_SIZE, file.size);
        const chunk = file.slice(start, end);
        const partNumber = i + 1;
        const pct = Math.round(((i + 0.5) / totalParts) * 85);
        setProgress(pct);
        setStatusLabel(`Uploading… ${pct}% (part ${partNumber}/${totalParts})`);
        if (partNumber % 5 === 1) addLog(`Uploading part ${partNumber}/${totalParts}`);

        const part = await uploader.uploadPart(partNumber, chunk);
        parts.push(part);
      }

      setProgress(88);
      setStatusLabel("Finishing upload…");
      const blob = await uploader.complete(parts);
      blobUrl = blob.url;
      setProgress(90);
      addLog(`Stored: ${blobUrl}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload to storage failed";
      addLog(`UPLOAD ERROR: ${msg}`);
      setError(msg);
      setStatus("error");
      return;
    }

    setArchiveUrl(blobUrl);

    if (addToCatalog && parsedChapters) {
      setStatusLabel("Adding to catalog…");
      setProgress(95);
      const catalogRes = await fetch("/api/admin/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: slug,
          title,
          edition: edition || null,
          isbn: isbn || null,
          sourceType: "oer",
          sourceUrl: blobUrl,
          chapterPageRanges: parsedChapters,
          pageOffset,
        }),
      });
      if (!catalogRes.ok) {
        setError("Uploaded but failed to add to textbook catalog.");
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
    setArchiveLink("");
    setArchiveLinkError(null);
    setArchiveDownloading(false);
    setAddToCatalog(true);
    setTocRows([{ label: "1", startPage: 1, endPage: 50 }, { label: "2", startPage: 51, endPage: 100 }]);
    setPageOffset(0);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-gray-400 mb-6">
        Upload a PDF to permanent storage and optionally add it to the public textbook catalog.
        Or paste a link to import an existing PDF.
      </p>

      {/* Import from URL */}
      {status === "idle" && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 mb-6 space-y-3">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
            Import from link
          </p>
          <p className="text-xs text-gray-500">
            Paste any PDF link (archive.org, direct URL, etc.) — the file will be downloaded and stored permanently
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              value={archiveLink}
              onChange={(e) => { setArchiveLink(e.target.value); setArchiveLinkError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleLinkImport()}
              placeholder="https://example.com/textbook.pdf"
              className="flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500"
            />
            <button
              onClick={handleLinkImport}
              disabled={!archiveLink.trim() || archiveDownloading}
              className="rounded-lg bg-white text-black px-4 py-2 text-sm font-medium hover:bg-gray-200 transition disabled:opacity-40"
            >
              {archiveDownloading ? "Downloading…" : "Download & store"}
            </button>
          </div>
          {archiveLinkError && <p className="text-xs text-red-400">{archiveLinkError}</p>}
          <div className="border-t border-gray-800 pt-3 mt-3">
            <p className="text-xs text-gray-500 text-center">— or upload a file below —</p>
          </div>
        </div>
      )}

      {status === "done" ? (
        <div className="rounded-xl border border-green-700 bg-green-900/20 p-6 space-y-3">
          <p className="text-green-400 font-semibold text-base">Stored!</p>
          <p className="text-sm text-gray-300">Permanent storage link:</p>
          <a href={archiveUrl!} target="_blank" rel="noopener noreferrer" className="block text-sm text-blue-400 underline break-all">{archiveUrl}</a>
          {addToCatalog && <p className="text-sm text-gray-400">Also added to the textbook catalog — users can now find it in the document picker.</p>}

          {/* Offer catalog add if from link paste and not yet cataloged */}
          {!addToCatalog && (
            <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-4 space-y-3 mt-2">
              <p className="text-sm font-medium text-gray-300">Add to textbook catalog?</p>
              <div className="space-y-2">
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title *" className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm" />
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="Edition" className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm" />
                  <input type="text" value={isbn} onChange={(e) => setIsbn(e.target.value)} placeholder="ISBN" className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm" />
                </div>
                <TocEditor
                  rows={tocRows}
                  onChange={setTocRows}
                  pageOffset={pageOffset}
                  onPageOffsetChange={setPageOffset}
                />
                {error && <p className="text-xs text-red-400">{error}</p>}
                <button
                  onClick={handleAddToCatalog}
                  disabled={!title}
                  className="w-full rounded-lg bg-white text-black py-2 text-sm font-semibold hover:bg-gray-200 transition disabled:opacity-40"
                >
                  Add to catalog
                </button>
              </div>
            </div>
          )}

          <button onClick={reset} className="mt-2 rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 transition">Start over</button>
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
              <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide">Storage Identifier</label>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="auto-generated from title"
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500 font-mono"
              />
              <p className="text-xs text-gray-600 mt-1">Used to organize files in storage. Auto-generated but you can edit it.</p>
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
                <TocEditor
                  rows={tocRows}
                  onChange={setTocRows}
                  pageOffset={pageOffset}
                  onPageOffsetChange={setPageOffset}
                />
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
            disabled={status === "uploading" || !file || !title}
            className="w-full rounded-lg bg-white text-black py-2.5 text-sm font-semibold hover:bg-gray-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {status === "uploading" ? `${statusLabel || "Uploading…"} ${progress}%` : "Upload & store"}
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

  const [editTocEntry, setEditTocEntry] = useState<CatalogEntry | null>(null);
  const [editTocRows, setEditTocRows] = useState<TocRow[]>([]);
  const [editPageOffset, setEditPageOffset] = useState(0);
  const [savingToc, setSavingToc] = useState(false);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);

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

  function openTocEditor(entry: CatalogEntry) {
    const offset = entry.pageOffset ?? 0;
    setEditPageOffset(offset);
    setEditTocRows(rangesToTocRows(entry.chapterPageRanges, offset));
    setEditTocEntry(entry);
  }

  async function saveToc() {
    if (!editTocEntry) return;
    setSavingToc(true);
    const ranges = tocRowsToRanges(editTocRows, editPageOffset);
    const res = await fetch("/api/admin/catalog", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editTocEntry.id,
        chapterPageRanges: ranges,
        pageOffset: editPageOffset,
      }),
    });
    if (res.ok) {
      setEntries((prev) =>
        prev?.map((e) =>
          e.id === editTocEntry.id
            ? { ...e, chapterPageRanges: ranges, pageOffset: editPageOffset }
            : e
        ) ?? null
      );
      setEditTocEntry(null);
    } else {
      alert("Failed to save chapters");
    }
    setSavingToc(false);
  }

  function startRename(entry: CatalogEntry) {
    setRenamingId(entry.id);
    setRenameValue(entry.title);
  }

  async function saveRename() {
    if (!renamingId || !renameValue.trim()) return;
    setSavingRename(true);
    const res = await fetch("/api/admin/catalog", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: renamingId, title: renameValue.trim() }),
    });
    if (res.ok) {
      setEntries((prev) =>
        prev?.map((e) => e.id === renamingId ? { ...e, title: renameValue.trim() } : e) ?? null
      );
      setRenamingId(null);
    } else {
      alert("Failed to rename");
    }
    setSavingRename(false);
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
            <div key={entry.id} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {renamingId === entry.id ? (
                    <form
                      onSubmit={(e) => { e.preventDefault(); saveRename(); }}
                      className="flex items-center gap-2"
                    >
                      <input
                        autoFocus
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Escape") setRenamingId(null); }}
                        className="rounded border border-gray-600 bg-gray-950 px-2 py-0.5 text-sm font-medium focus:outline-none focus:border-gray-400"
                      />
                      <button
                        type="submit"
                        disabled={savingRename || !renameValue.trim()}
                        className="rounded bg-white text-black px-2 py-0.5 text-xs font-medium hover:bg-gray-200 transition disabled:opacity-40"
                      >
                        {savingRename ? "…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingId(null)}
                        className="text-xs text-gray-500 hover:text-gray-300"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <p className="font-medium text-sm cursor-pointer hover:text-gray-300 transition" onClick={() => startRename(entry)} title="Click to rename">{entry.title}</p>
                  )}
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
                  <span className="text-xs text-gray-500">
                    {chapterCount} chapter{chapterCount !== 1 ? "s" : ""}
                    {entry.pageOffset > 0 && <span className="text-gray-600"> (offset {entry.pageOffset})</span>}
                  </span>
                  {entry.sourceUrl && (
                    <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:text-blue-400 underline truncate max-w-xs">
                      {entry.sourceUrl}
                    </a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2 overflow-x-auto">
                <button
                  onClick={() => startRename(entry)}
                  className="rounded-md border border-gray-600 px-3 py-1 text-xs text-gray-400 hover:bg-gray-800 transition whitespace-nowrap"
                >
                  Rename
                </button>
                <button
                  onClick={() => openTocEditor(entry)}
                  className="rounded-md border border-blue-800 px-3 py-1 text-xs text-blue-400 hover:bg-blue-900/30 transition whitespace-nowrap"
                >
                  Edit TOC
                </button>
                {entry.hidden ? (
                  <button
                    onClick={() => unhideEntry(entry)}
                    disabled={patching === entry.id}
                    className="rounded-md border border-amber-700 px-3 py-1 text-xs text-amber-400 hover:bg-amber-900/30 transition disabled:opacity-40 whitespace-nowrap"
                  >
                    {patching === entry.id ? "…" : "Unhide"}
                  </button>
                ) : (
                  <button
                    onClick={() => openHideModal(entry)}
                    disabled={patching === entry.id}
                    className="rounded-md border border-gray-600 px-3 py-1 text-xs text-gray-400 hover:bg-gray-800 transition disabled:opacity-40 whitespace-nowrap"
                  >
                    Hide
                  </button>
                )}
                <button
                  onClick={() => setConfirmDelete(entry)}
                  disabled={deleting === entry.id}
                  className="rounded-md border border-red-800 px-3 py-1 text-xs text-red-400 hover:bg-red-900/30 transition disabled:opacity-40 whitespace-nowrap"
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

      {editTocEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl bg-gray-900 border border-gray-700 p-6 shadow-2xl max-h-[90vh] flex flex-col">
            <h2 className="text-base font-semibold mb-0.5">Edit Table of Contents</h2>
            <p className="text-sm text-gray-400 mb-4">
              <span className="text-white font-medium">{editTocEntry.title}</span>
              {editTocEntry.edition && <span className="text-gray-500"> ({editTocEntry.edition} ed.)</span>}
            </p>
            <div className="flex-1 overflow-y-auto min-h-0 pr-1 -mr-1">
              <TocEditor
                rows={editTocRows}
                onChange={setEditTocRows}
                pageOffset={editPageOffset}
                onPageOffsetChange={setEditPageOffset}
              />
            </div>
            <div className="flex gap-2 mt-4 pt-4 border-t border-gray-800">
              <button
                onClick={() => setEditTocEntry(null)}
                className="flex-1 rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 transition"
              >
                Cancel
              </button>
              <button
                onClick={saveToc}
                disabled={savingToc}
                className="flex-1 rounded-lg bg-white text-black px-4 py-2 text-sm font-medium hover:bg-gray-200 transition disabled:opacity-50"
              >
                {savingToc ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Messages Tab ────────────────────────────────────────────────────

interface Conversation {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  lastMessage: string;
  lastAt: string;
  unread: number;
  muted: boolean;
  mutedUntil: string | null;
  blocked: boolean;
}

interface ChatMsg {
  id: string;
  fromUserId: string;
  toUserId: string;
  content: string;
  createdAt: string | null;
}

// ── Storage Tab ───────────────────────────────────────────────────────────

interface BlobItem {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string;
}

function StorageTab() {
  const [blobs, setBlobs] = useState<BlobItem[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BlobItem | null>(null);
  const [filter, setFilter] = useState<"all" | "user" | "admin">("all");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/blobs");
    if (res.ok) {
      const data = await res.json();
      setBlobs(data.blobs);
      setTotalSize(data.totalSize);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function deleteBlob(blob: BlobItem) {
    setDeleting(blob.url);
    const res = await fetch(`/api/admin/blobs?url=${encodeURIComponent(blob.url)}`, { method: "DELETE" });
    if (res.ok) {
      setBlobs((prev) => prev.filter((b) => b.url !== blob.url));
      setTotalSize((prev) => prev - blob.size);
    } else {
      alert("Failed to delete blob");
    }
    setDeleting(null);
    setConfirmDelete(null);
  }

  const fmtSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const isUserUpload = (b: BlobItem) => b.pathname.startsWith("uploads/");
  const isAdminUpload = (b: BlobItem) => b.pathname.startsWith("public/");

  const filtered = blobs.filter((b) => {
    if (filter === "user") return isUserUpload(b);
    if (filter === "admin") return isAdminUpload(b);
    return true;
  });

  const userBlobs = blobs.filter(isUserUpload);
  const adminBlobs = blobs.filter(isAdminUpload);
  const quotaGB = 1;
  const usedPct = Math.min(100, (totalSize / (quotaGB * 1024 * 1024 * 1024)) * 100);

  if (loading) {
    return <p className="text-gray-400 animate-pulse py-8 text-center text-sm">Loading blob storage…</p>;
  }

  return (
    <>
      {/* Usage overview */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Storage Usage</h2>
          <button onClick={load} className="rounded-lg border border-gray-700 px-3 py-1 text-xs hover:bg-gray-800 transition">Refresh</button>
        </div>
        <div className="h-3 rounded-full bg-gray-800 overflow-hidden mb-2">
          <div
            className={`h-full rounded-full transition-all ${usedPct > 90 ? "bg-red-500" : usedPct > 70 ? "bg-amber-500" : "bg-blue-500"}`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-400">
          <span>{fmtSize(totalSize)} used</span>
          <span>{quotaGB} GB limit ({usedPct.toFixed(1)}%)</span>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="rounded-lg border border-gray-800 p-3 text-center">
            <p className="text-lg font-bold">{blobs.length}</p>
            <p className="text-xs text-gray-500">Total files</p>
          </div>
          <div className="rounded-lg border border-gray-800 p-3 text-center">
            <p className="text-lg font-bold">{adminBlobs.length}</p>
            <p className="text-xs text-gray-500">Catalog ({fmtSize(adminBlobs.reduce((s, b) => s + b.size, 0))})</p>
          </div>
          <div className="rounded-lg border border-gray-800 p-3 text-center">
            <p className="text-lg font-bold">{userBlobs.length}</p>
            <p className="text-xs text-gray-500">User uploads ({fmtSize(userBlobs.reduce((s, b) => s + b.size, 0))})</p>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {(["all", "user", "admin"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              filter === f ? "bg-white text-black" : "border border-gray-700 text-gray-400 hover:bg-gray-800"
            }`}
          >
            {f === "all" ? `All (${blobs.length})` : f === "user" ? `User uploads (${userBlobs.length})` : `Catalog (${adminBlobs.length})`}
          </button>
        ))}
      </div>

      {/* Blob list */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-center text-gray-500 py-8 text-sm">No blobs found.</p>
        )}
        {filtered
          .sort((a, b) => b.size - a.size)
          .map((blob) => {
            const name = decodeURIComponent(blob.pathname.split("/").pop() ?? blob.pathname);
            const folder = blob.pathname.substring(0, blob.pathname.lastIndexOf("/"));
            return (
              <div key={blob.url} className="rounded-xl border border-gray-800 bg-gray-900 p-4 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" title={name}>{name}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-500">
                    <span className={`px-1.5 py-0.5 rounded font-medium ${isUserUpload(blob) ? "bg-blue-900/50 text-blue-400" : "bg-green-900/50 text-green-400"}`}>
                      {isUserUpload(blob) ? "User" : "Catalog"}
                    </span>
                    <span className="font-mono">{fmtSize(blob.size)}</span>
                    <span>{new Date(blob.uploadedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="truncate max-w-[200px] text-gray-600" title={folder}>{folder}/</span>
                  </div>
                </div>
                <button
                  onClick={() => setConfirmDelete(blob)}
                  disabled={deleting === blob.url}
                  className="rounded-md border border-red-800 px-3 py-1 text-xs text-red-400 hover:bg-red-900/30 transition disabled:opacity-40 flex-shrink-0"
                >
                  {deleting === blob.url ? "…" : "Delete"}
                </button>
              </div>
            );
          })}
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-700 p-6 shadow-2xl">
            <h2 className="text-base font-semibold mb-1">Delete this blob?</h2>
            <p className="text-sm text-gray-400 mb-1 truncate">{decodeURIComponent(confirmDelete.pathname)}</p>
            <p className="text-sm text-gray-500 mb-1">{fmtSize(confirmDelete.size)}</p>
            <p className="text-sm text-red-400 mb-5">This will permanently delete the file from Vercel Blob storage. Any sessions or documents referencing it will break.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 transition">Cancel</button>
              <button onClick={() => deleteBlob(confirmDelete)} disabled={deleting === confirmDelete.url} className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium hover:bg-red-700 transition disabled:opacity-50">
                {deleting === confirmDelete.url ? "Deleting…" : "Yes, delete it"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Messages Tab ──────────────────────────────────────────────────────────

function MessagesTab() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [muteDuration, setMuteDuration] = useState(60);
  const [showMutePicker, setShowMutePicker] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(() => {
    fetch("/api/messages")
      .then((r) => (r.ok ? r.json() : { conversations: [] }))
      .then((data: { conversations?: Conversation[] }) => setConversations(data.conversations ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const openConversation = useCallback((userId: string) => {
    setSelectedUserId(userId);
    setShowMutePicker(false);
    setChatLoading(true);
    fetch(`/api/messages?userId=${userId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setChatMessages)
      .finally(() => setChatLoading(false));
    setConversations((prev) =>
      prev.map((c) => (c.userId === userId ? { ...c, unread: 0 } : c))
    );
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  async function sendReply() {
    if (!replyText.trim() || !selectedUserId || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: replyText, toUserId: selectedUserId }),
      });
      if (res.ok) {
        const msg = await res.json();
        setChatMessages((prev) => [...prev, msg]);
        setReplyText("");
      }
    } finally {
      setSending(false);
    }
  }

  async function handleMuteBlock(userId: string, action: "mute" | "unmute" | "block" | "unblock", durationMinutes?: number) {
    const res = await fetch("/api/admin/mute-block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action, durationMinutes }),
    });
    const data = await res.json().catch(() => ({}));
    setConversations((prev) =>
      prev.map((c) => {
        if (c.userId !== userId) return c;
        return {
          ...c,
          muted: action === "mute" ? true : action === "unmute" ? false : c.muted,
          mutedUntil: action === "mute" ? (data.mutedUntil ?? null) : action === "unmute" ? null : c.mutedUntil,
          blocked: action === "block" ? true : action === "unblock" ? false : c.blocked,
        };
      })
    );
    setShowMutePicker(false);
  }

  const selected = conversations.find((c) => c.userId === selectedUserId);

  if (loading) {
    return <p className="text-gray-400 animate-pulse py-10 text-center">Loading messages…</p>;
  }

  return (
    <div className="flex gap-4" style={{ minHeight: 500 }}>
      {/* Conversation list */}
      <div className="w-72 flex-shrink-0 rounded-lg border border-gray-800 overflow-auto">
        {conversations.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-10">No messages yet</p>
        ) : (
          <ul className="divide-y divide-gray-800">
            {conversations.map((c) => (
              <li key={c.userId}>
                <button
                  onClick={() => openConversation(c.userId)}
                  className={`w-full text-left px-4 py-3 transition ${
                    selectedUserId === c.userId
                      ? "bg-gray-800"
                      : "hover:bg-gray-800/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate">
                      {c.userName ?? c.userEmail ?? c.userId.slice(0, 8)}
                    </p>
                    <div className="flex items-center gap-1.5">
                      {c.blocked && (
                        <span className="text-[10px] rounded bg-red-900 text-red-300 px-1.5 py-0.5">blocked</span>
                      )}
                      {c.muted && !c.blocked && (
                        <span className="text-[10px] rounded bg-yellow-900 text-yellow-300 px-1.5 py-0.5" title={c.mutedUntil ? `Until ${new Date(c.mutedUntil).toLocaleString()}` : ""}>
                          muted{c.mutedUntil && ` · ${new Date(c.mutedUntil).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}
                        </span>
                      )}
                      {c.unread > 0 && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">
                          {c.unread}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{c.lastMessage}</p>
                  {c.lastAt && (
                    <p className="text-[10px] text-gray-600 mt-0.5">
                      {new Date(c.lastAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 rounded-lg border border-gray-800 flex flex-col">
        {!selectedUserId ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-gray-500">Select a conversation</p>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
              <div>
                <p className="text-sm font-medium">
                  {selected?.userName ?? selected?.userEmail ?? selectedUserId.slice(0, 8)}
                </p>
                {selected?.userEmail && (
                  <p className="text-xs text-gray-500">{selected.userEmail}</p>
                )}
              </div>
              <div className="flex gap-2">
                <div className="relative">
                  {selected?.muted ? (
                    <button
                      onClick={() => handleMuteBlock(selectedUserId, "unmute")}
                      className="rounded-md px-3 py-1.5 text-xs border border-yellow-600 text-yellow-400 hover:bg-yellow-900/20 transition"
                      title={selected.mutedUntil ? `Muted until ${new Date(selected.mutedUntil).toLocaleString()}` : "Muted"}
                    >
                      Unmute
                      {selected.mutedUntil && (
                        <span className="ml-1 text-[10px] text-yellow-500">
                          ({new Date(selected.mutedUntil).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })})
                        </span>
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowMutePicker((v) => !v)}
                      className="rounded-md px-3 py-1.5 text-xs border border-gray-700 text-gray-400 hover:bg-gray-800 transition"
                    >
                      Mute
                    </button>
                  )}
                  {showMutePicker && !selected?.muted && (
                    <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-xl">
                      <p className="text-xs font-medium text-gray-300 mb-2">Mute duration</p>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {[
                          { label: "15m", mins: 15 },
                          { label: "1h", mins: 60 },
                          { label: "6h", mins: 360 },
                          { label: "24h", mins: 1440 },
                          { label: "7d", mins: 10080 },
                          { label: "30d", mins: 43200 },
                        ].map((opt) => (
                          <button
                            key={opt.mins}
                            onClick={() => setMuteDuration(opt.mins)}
                            className={`rounded px-2 py-1 text-xs transition ${
                              muteDuration === opt.mins
                                ? "bg-yellow-600 text-white"
                                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => handleMuteBlock(selectedUserId, "mute", muteDuration)}
                        className="w-full rounded-md bg-yellow-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-yellow-700 transition"
                      >
                        Mute for {muteDuration >= 1440 ? `${Math.round(muteDuration / 1440)}d` : muteDuration >= 60 ? `${Math.round(muteDuration / 60)}h` : `${muteDuration}m`}
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={() =>
                    handleMuteBlock(selectedUserId, selected?.blocked ? "unblock" : "block")
                  }
                  className={`rounded-md px-3 py-1.5 text-xs border transition ${
                    selected?.blocked
                      ? "border-red-600 text-red-400 hover:bg-red-900/20"
                      : "border-gray-700 text-gray-400 hover:bg-gray-800"
                  }`}
                >
                  {selected?.blocked ? "Unblock" : "Block"}
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-auto px-4 py-4 space-y-3">
              {chatLoading ? (
                <p className="text-gray-400 animate-pulse text-center py-10">Loading…</p>
              ) : chatMessages.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-10">No messages in this conversation</p>
              ) : (
                chatMessages.map((msg) => {
                  const isAdmin = msg.fromUserId !== selectedUserId;
                  return (
                    <div key={msg.id} className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[70%] rounded-xl px-3 py-2 text-sm ${
                          isAdmin
                            ? "bg-blue-600 text-white"
                            : "bg-gray-800 text-gray-200"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        {msg.createdAt && (
                          <p className={`text-[10px] mt-1 ${isAdmin ? "text-blue-200" : "text-gray-500"}`}>
                            {new Date(msg.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Reply */}
            <div className="border-t border-gray-800 px-4 py-3 flex gap-2">
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendReply()}
                placeholder={selected?.blocked ? "User is blocked" : "Reply…"}
                disabled={selected?.blocked}
                maxLength={2000}
                className="flex-1 rounded-lg border border-gray-700 bg-transparent px-3 py-2 text-sm disabled:opacity-40"
              />
              <button
                onClick={sendReply}
                disabled={sending || !replyText.trim() || selected?.blocked}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 hover:bg-blue-700 transition"
              >
                {sending ? "…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
