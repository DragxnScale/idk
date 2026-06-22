"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { uploadPdfToStorage } from "@/lib/upload-client";
import Link from "next/link";
import { OwnerAiTab } from "@/components/admin/OwnerAiTab";
import { AppUiEditorTab } from "@/components/admin/AppUiEditorTab";
import { AiContentTab } from "@/components/admin/AiContentTab";
import { AdminStudyCalendar } from "@/components/admin/AdminStudyCalendar";
import { UserAiUsageLog } from "@/components/admin/UserAiUsageLog";
import { TocEditor } from "@/components/TocEditor";
import { rangesToTocRows, tocRowsToRanges, type TocRow } from "@/lib/toc-editor-utils";

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
  /** Lifetime prompt + completion token total across all AI routes. */
  aiTokensUsed?: number;
  /** Per-user override. null when falling back to the deploy-level default. */
  aiTokenLimit?: number | null;
  /** Effective limit actually enforced: per-user override OR the default. null = unlimited. */
  aiTokenLimitEffective?: number | null;
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
  /** Subset of duration when the timer was actually running. NULL on legacy rows that predate per-page focus tracking. */
  focusedSeconds: number | null;
}

interface QuizSummary {
  id: string;
  score: number | null;
  totalQuestions: number | null;
  accuracy: number | null;
  completed: boolean;
  createdAt: string | null;
  questions: { question: string; options: string[]; correctIndex: number; explanation?: string }[];
  review: unknown;
}

interface VelocityAttemptAdmin {
  topic: string;
  question: string;
  userAnswer?: string;
  correctAnswer: string;
  correct: boolean;
  reactionMs: number | null;
  type: "mc" | "sa";
}

interface VelocitySummary {
  id: string;
  accuracy: number | null;
  avgReactionMs: number | null;
  fastestMs: number | null;
  slowestMs: number | null;
  correctCount: number;
  total: number;
  score?: number;
  negCount?: number;
  streakBest?: number;
  completed: boolean;
  createdAt: string | null;
  completedAt: string | null;
  attempts: VelocityAttemptAdmin[];
  review:
    | {
        growthAreas?: { topic: string; tip: string }[];
        videoSuggestions?: { title: string; searchQuery: string; reason: string }[];
      }
    | null
    | unknown;
}

interface SessionDetail {
  session: UserSession;
  document: {
    title?: string;
    chapterPageRanges?: Record<string, [number, number]>;
    selectedChapters?: string[];
  };
  pageVisits: PageVisit[];
  quiz?: QuizSummary | null;
  velocity?: VelocitySummary | null;
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

type Tab = "users" | "aiContent" | "appUi" | "upload" | "catalog" | "messages" | "storage" | "debug" | "owner";

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

function fmtHmsFromMinutes(minutes: number): string {
  const totalSec = Math.max(0, Math.round(minutes * 60));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type StudyChartRange = "7" | "30";

interface StudyChartDay {
  date: string;
  minutes: number;
  sessions: number;
}

const STUDY_CHART_BAR_MAX_PX = 104;
const STUDY_CHART_MIN_BAR_PX = 8;

/** Per-day focused minutes from completed sessions (UTC date keys, matches dashboard heatmap). */
function buildMinutesByDay(sessions: UserSession[]): {
  minutesByDay: Record<string, { minutes: number; sessions: number }>;
  earliestDate: string | null;
} {
  const minutesByDay: Record<string, { minutes: number; sessions: number }> = {};
  let earliestDate: string | null = null;

  for (const s of sessions) {
    if (!s.endedAt || !s.startedAt) continue;
    const dayStr = new Date(s.startedAt).toISOString().slice(0, 10);
    if (!minutesByDay[dayStr]) {
      minutesByDay[dayStr] = { minutes: 0, sessions: 0 };
    }
    minutesByDay[dayStr].minutes += s.totalFocusedMinutes ?? 0;
    minutesByDay[dayStr].sessions += 1;
    if (!earliestDate || dayStr < earliestDate) earliestDate = dayStr;
  }

  return { minutesByDay, earliestDate };
}

function getStudyCalendarBounds(): {
  minYear: number;
  minMonth: number;
  maxYear: number;
  maxMonth: number;
} {
  const now = new Date();
  const maxYear = now.getUTCFullYear();
  const maxMonth = now.getUTCMonth() + 1;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDate = new Date(today);
  minDate.setDate(minDate.getDate() - 29);

  return {
    minYear: minDate.getUTCFullYear(),
    minMonth: minDate.getUTCMonth() + 1,
    maxYear,
    maxMonth,
  };
}

function buildStudyChartDays(sessions: UserSession[], range: StudyChartRange): StudyChartDay[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { minutesByDay } = buildMinutesByDay(sessions);

  let start: Date;
  if (range === "30") {
    start = new Date(today);
    start.setDate(start.getDate() - 29);
  } else {
    start = new Date(today);
    start.setDate(start.getDate() - 6);
  }

  const days: StudyChartDay[] = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(today);

  while (cur <= end) {
    const dayStr = cur.toISOString().slice(0, 10);
    const bucket = minutesByDay[dayStr];
    days.push({
      date: dayStr,
      minutes: bucket?.minutes ?? 0,
      sessions: bucket?.sessions ?? 0,
    });
    cur.setDate(cur.getDate() + 1);
  }

  return days;
}

/** One step in the reading path after merging consecutive same-page rows (30s flush artifacts). */
interface MergedPageVisit {
  id: string;
  pageNumber: number;
  enteredAt: string | null;
  durationSeconds: number;
  focusedSeconds: number | null;
}

/**
 * Collapse consecutive visits to the same page into one step so periodic
 * PdfViewer flushes don't split a single long stay into repeated rows.
 * True revisits (e.g. 3 → 4 → 3) stay separate because they aren't adjacent.
 */
function mergeConsecutivePageVisits(visits: PageVisit[]): MergedPageVisit[] {
  if (visits.length === 0) return [];
  const merged: MergedPageVisit[] = [];
  let current: MergedPageVisit = {
    id: visits[0].id,
    pageNumber: visits[0].pageNumber,
    enteredAt: visits[0].enteredAt,
    durationSeconds: visits[0].durationSeconds ?? 0,
    focusedSeconds: visits[0].focusedSeconds,
  };
  for (let i = 1; i < visits.length; i++) {
    const v = visits[i];
    if (v.pageNumber === current.pageNumber) {
      current.durationSeconds += v.durationSeconds ?? 0;
      if (v.focusedSeconds != null) {
        current.focusedSeconds = (current.focusedSeconds ?? 0) + v.focusedSeconds;
      }
    } else {
      merged.push(current);
      current = {
        id: v.id,
        pageNumber: v.pageNumber,
        enteredAt: v.enteredAt,
        durationSeconds: v.durationSeconds ?? 0,
        focusedSeconds: v.focusedSeconds,
      };
    }
  }
  merged.push(current);
  return merged;
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [ownerTabVisible, setOwnerTabVisible] = useState(false);
  /**
   * Whether the *real* signed-in admin has developer-mode on. Drives
   * extra diagnostic surfaces (currently the "Focused studying per
   * page" panel on each session detail).
   *
   * Read from `/api/user/session-context` because that endpoint
   * always reports the real JWT identity even while view-as is active —
   * so impersonating a regular user from a developer admin still shows
   * the panel, and impersonating any user from a non-developer admin
   * does not.
   */
  const [isDeveloperMode, setIsDeveloperMode] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (
      t === "users" ||
      t === "aiContent" ||
      t === "appUi" ||
      t === "upload" ||
      t === "catalog" ||
      t === "messages" ||
      t === "storage" ||
      t === "debug" ||
      t === "owner"
    ) {
      setTab(t);
    }
  }, []);

  // auth check on first load; owner tab only for super-owner (see lib/admin.ts)
  useEffect(() => {
    Promise.all([
      fetch("/api/admin/users"),
      fetch("/api/admin/owner-ai"),
      fetch("/api/user/session-context"),
    ]).then(([usersRes, ownerRes, ctxRes]) => {
      if (usersRes.status === 403) setForbidden(true);
      else setOwnerTabVisible(ownerRes.ok);
      if (ctxRes.ok) {
        ctxRes
          .json()
          .then((d) => setIsDeveloperMode(!!d?.isDeveloper))
          .catch(() => {});
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!ownerTabVisible && (tab === "owner" || tab === "debug")) setTab("users");
  }, [ownerTabVisible, tab]);

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
            {(
              [
                "users",
                "aiContent",
                "appUi",
                "upload",
                "catalog",
                "messages",
                "storage",
                ...(ownerTabVisible ? (["debug", "owner"] as const) : []),
              ] as Tab[]
            ).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-2.5 text-sm font-medium capitalize transition rounded-t-lg -mb-px border-b-2 whitespace-nowrap ${
                  tab === t
                    ? "border-white text-white"
                    : "border-transparent text-gray-500 hover:text-gray-300"
                }`}
              >
                {t === "aiContent"
                  ? "AI Content"
                  : t === "appUi"
                  ? "App UI"
                  : t === "upload"
                  ? "Upload to Archive"
                  : t === "catalog"
                    ? "Textbook Catalog"
                    : t === "messages"
                      ? "Messages"
                      : t === "storage"
                        ? "R2 Storage"
                        : t === "debug"
                          ? "Debug log"
                          : t === "owner"
                            ? "Owner AI"
                            : "Users"}
              </button>
            ))}
          </div>
        </div>

        {tab === "users" && <UsersTab isDeveloperMode={isDeveloperMode} />}
        {tab === "aiContent" && <AiContentTab />}
        {tab === "appUi" && <AppUiEditorTab />}
        {tab === "upload" && <UploadTab />}
        {tab === "catalog" && <CatalogTab />}
        {tab === "messages" && <MessagesTab />}
        {tab === "storage" && <StorageTab />}
        {tab === "debug" && ownerTabVisible && <DebugLogsTab />}
        {tab === "owner" && ownerTabVisible && <OwnerAiTab />}
      </div>
    </main>
  );
}

// ── Users Tab ──────────────────────────────────────────────────────────────

function UsersTab({ isDeveloperMode }: { isDeveloperMode: boolean }) {
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
  const [userStorageQuotaMB, setUserStorageQuotaMB] = useState<string>("");
  const [userAiTokenLimit, setUserAiTokenLimit] = useState<string>("");
  const [userAiTokensUsed, setUserAiTokensUsed] = useState<number>(0);
  const [savingAiTokenLimit, setSavingAiTokenLimit] = useState(false);
  const [resettingAiTokens, setResettingAiTokens] = useState(false);
  const [savingInactivity, setSavingInactivity] = useState(false);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [readingTimeView, setReadingTimeView] = useState<"path" | "summary">("path");
  const [studyChartRange, setStudyChartRange] = useState<StudyChartRange>("7");
  const [studyCalendarYear, setStudyCalendarYear] = useState(() => new Date().getUTCFullYear());
  const [studyCalendarMonth, setStudyCalendarMonth] = useState(() => new Date().getUTCMonth() + 1);
  const [userDetailTab, setUserDetailTab] = useState<"overview" | "ai-usage">("overview");
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [togglingAdmin, setTogglingAdmin] = useState<string | null>(null);
  const [viewAsLoading, setViewAsLoading] = useState<string | null>(null);

  useEffect(() => {
    setReadingTimeView("path");
  }, [sessionDetail?.session.id]);

  useEffect(() => {
    setStudyChartRange("7");
    setUserDetailTab("overview");
    const t = new Date();
    setStudyCalendarYear(t.getUTCFullYear());
    setStudyCalendarMonth(t.getUTCMonth() + 1);
  }, [selectedUser?.id]);

  useEffect(() => {
    const t = new Date();
    setStudyCalendarYear(t.getUTCFullYear());
    setStudyCalendarMonth(t.getUTCMonth() + 1);
  }, [studyChartRange]);

  async function viewAsUser(user: UserRow) {
    setViewAsLoading(user.id);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error ?? "Could not switch view");
        return;
      }
      window.location.href = "/dashboard";
    } finally {
      setViewAsLoading(null);
    }
  }

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

  const [banBlacklist, setBanBlacklist] = useState(true);
  const [bannedList, setBannedList] = useState<{ email: string; reason: string | null; bannedBy: string | null; bannedAt: string | null }[]>([]);
  const [showBanned, setShowBanned] = useState(false);
  const [newBanEmail, setNewBanEmail] = useState("");
  const [addingBan, setAddingBan] = useState(false);

  async function banUser(user: UserRow) {
    setBanning(user.id);
    const params = new URLSearchParams();
    if (!banBlacklist) params.set("blacklist", "false");
    const res = await fetch(`/api/admin/users/${user.id}?${params}`, { method: "DELETE" });
    if (res.ok) {
      setUsers((prev) => prev?.filter((u) => u.id !== user.id) ?? null);
      if (selectedUser?.id === user.id) { setSelectedUser(null); setUserSessions(null); }
      if (banBlacklist) loadBannedList();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Failed to ban user");
    }
    setBanning(null);
    setConfirmBan(null);
    setBanBlacklist(true);
  }

  async function loadBannedList() {
    const res = await fetch("/api/admin/banned-emails");
    if (res.ok) setBannedList(await res.json());
  }

  async function addBannedEmail() {
    if (!newBanEmail.trim()) return;
    setAddingBan(true);
    const res = await fetch("/api/admin/banned-emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newBanEmail.trim() }),
    });
    if (res.ok) {
      setNewBanEmail("");
      loadBannedList();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Failed to add banned email");
    }
    setAddingBan(false);
  }

  async function removeBannedEmail(email: string) {
    await fetch(`/api/admin/banned-emails?email=${encodeURIComponent(email)}`, { method: "DELETE" });
    setBannedList((prev) => prev.filter((b) => b.email !== email));
  }

  useEffect(() => { if (showBanned) loadBannedList(); }, [showBanned]);

  async function openUserDetail(user: UserRow) {
    setSelectedUser(user);
    setUserSessions(null);
    setUserInactivityTimeout("");
    setUserStorageQuotaMB("");
    setUserAiTokenLimit("");
    setUserAiTokensUsed(user.aiTokensUsed ?? 0);
    const res = await fetch(`/api/admin/users/${user.id}`);
    if (res.ok) {
      const data = await res.json();
      setUserSessions(data.sessions);
      if (data.user?.inactivityTimeout != null) {
        setUserInactivityTimeout(String(data.user.inactivityTimeout));
      }
      if (data.user?.storageQuotaBytes != null) {
        setUserStorageQuotaMB(String(Math.round(data.user.storageQuotaBytes / 1024 / 1024)));
      }
      if (data.user?.aiTokenLimit != null) {
        setUserAiTokenLimit(String(data.user.aiTokenLimit));
      }
      if (typeof data.user?.aiTokensUsed === "number") {
        setUserAiTokensUsed(data.user.aiTokensUsed);
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
    const { session: sd, document: doc, pageVisits: visits, quiz, velocity } = sessionDetail;

    const pathSteps = mergeConsecutivePageVisits(visits);

    // Aggregate time per page (summary tab)
    const pageTimeMap = new Map<number, number>();
    for (const v of visits) {
      const dur = v.durationSeconds ?? 0;
      pageTimeMap.set(v.pageNumber, (pageTimeMap.get(v.pageNumber) ?? 0) + dur);
    }
    const uniquePages = Array.from(new Set(visits.map((v) => v.pageNumber))).sort((a, b) => a - b);
    const totalTrackedSeconds = Array.from(pageTimeMap.values()).reduce((a, b) => a + b, 0);
    const maxPathStepSeconds =
      pathSteps.length > 0 ? Math.max(...pathSteps.map((s) => s.durationSeconds), 1) : 1;

    // Focused-per-page aggregation (developer-mode panel below). NULL
    // focusedSeconds means the row predates per-page focus tracking, so
    // we fall back to the empty state instead of fabricating data.
    const focusedAvailable = visits.some((v) => v.focusedSeconds != null);
    const focusedTimeMap = new Map<number, number>();
    if (focusedAvailable) {
      for (const v of visits) {
        if (v.focusedSeconds == null) continue;
        focusedTimeMap.set(
          v.pageNumber,
          (focusedTimeMap.get(v.pageNumber) ?? 0) + v.focusedSeconds
        );
      }
    }
    const totalFocusedSecondsByPage = Array.from(focusedTimeMap.values()).reduce((a, b) => a + b, 0);
    const pagesWithFocus = Array.from(focusedTimeMap.entries()).filter(([, sec]) => sec > 0).length;
    const maxFocusOnAnyPage = focusedTimeMap.size > 0 ? Math.max(...Array.from(focusedTimeMap.values())) : 0;
    const maxFocusOnAnyPathStep =
      pathSteps.length > 0 ? Math.max(...pathSteps.map((s) => s.focusedSeconds ?? 0)) : 0;
    const maxPathFocusForBars = Math.max(maxFocusOnAnyPathStep, 1);
    const pathStepsWithFocus = pathSteps.filter((s) => (s.focusedSeconds ?? 0) > 0).length;
    const totalFocusedOnPath = pathSteps.reduce((sum, s) => sum + (s.focusedSeconds ?? 0), 0);
    /** Distraction-hint threshold: focused / wall-clock ratio below this is amber. */
    const DISTRACTED_RATIO = 0.25;
    /** Skip the warning for very short visits where the ratio is meaningless. */
    const RATIO_MIN_WALLCLOCK_SEC = 30;

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

        {/* Reading path / summary by page */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 mb-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-semibold">Page Reading Time</h3>
            <div className="flex rounded-lg border border-gray-700 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setReadingTimeView("path")}
                className={`rounded-md px-3 py-1 transition ${
                  readingTimeView === "path"
                    ? "bg-gray-700 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                Reading path
              </button>
              <button
                type="button"
                onClick={() => setReadingTimeView("summary")}
                className={`rounded-md px-3 py-1 transition ${
                  readingTimeView === "summary"
                    ? "bg-gray-700 text-white"
                    : "text-gray-400 hover:text-gray-200"
                }`}
              >
                Summary by page
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            {readingTimeView === "path"
              ? `${pathSteps.length} step${pathSteps.length !== 1 ? "s" : ""} · ${fmtSeconds(totalTrackedSeconds)} total tracked time`
              : `${uniquePages.length} unique pages · ${fmtSeconds(totalTrackedSeconds)} total tracked time`}
          </p>

          {visits.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No page visit data recorded for this session.</p>
          ) : readingTimeView === "path" ? (
            <div className="space-y-1 max-h-[50vh] overflow-y-auto pr-1">
              {pathSteps.map((step, idx) => {
                const ch = getChapterForPage(step.pageNumber);
                const barWidth = Math.max(2, (step.durationSeconds / maxPathStepSeconds) * 100);
                const enteredLabel = step.enteredAt
                  ? new Date(step.enteredAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : null;
                return (
                  <div
                    key={step.id}
                    className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-800/50 transition group"
                  >
                    <span className="w-8 text-[10px] text-gray-600 text-right font-mono flex-shrink-0">
                      #{idx + 1}
                    </span>
                    <span className="w-14 text-xs text-gray-400 text-right font-mono flex-shrink-0">
                      p. {step.pageNumber}
                    </span>
                    {ch && (
                      <span className="text-[10px] text-gray-500 w-20 truncate flex-shrink-0" title={ch}>
                        {ch}
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="h-4 rounded-full overflow-hidden bg-gray-800">
                        <div
                          className="h-full rounded-full bg-blue-500/70 transition-all"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-16 text-xs text-gray-400 text-right flex-shrink-0">
                      {fmtSeconds(step.durationSeconds)}
                    </span>
                    {enteredLabel && (
                      <span className="text-[10px] text-gray-600 w-14 text-right flex-shrink-0">{enteredLabel}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-1 max-h-[50vh] overflow-y-auto pr-1">
              {uniquePages.map((pg) => {
                const dur = pageTimeMap.get(pg) ?? 0;
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
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/*
          Focused studying per page — developer-mode-only diagnostic
          panel. Mirrors the reading-path / summary tabs above but uses
          `focusedSeconds` instead of wall-clock duration. Amber flags
          steps with low focus/wall-clock ratios (distraction patterns).
        */}
        {isDeveloperMode && (
          <div className="rounded-xl border border-amber-900/40 bg-gray-900 p-4 mb-5">
            <div className="flex items-start justify-between gap-3 mb-1">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  Focused studying per page
                  <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">Dev</span>
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {focusedAvailable
                    ? readingTimeView === "path"
                      ? `${pathStepsWithFocus} steps with focus · ${fmtSeconds(totalFocusedOnPath)} focused total`
                      : `${pagesWithFocus} pages with focus · ${fmtSeconds(totalFocusedSecondsByPage)} focused total`
                    : "Per-page focus data not yet recorded for this session."}
                </p>
                {focusedAvailable && (readingTimeView === "path" ? maxFocusOnAnyPathStep : maxFocusOnAnyPage) > 0 && (
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    Max focus on a single {readingTimeView === "path" ? "step" : "page"}:{" "}
                    {fmtSeconds(readingTimeView === "path" ? maxFocusOnAnyPathStep : maxFocusOnAnyPage)}
                  </p>
                )}
              </div>
            </div>

            {!focusedAvailable ? (
              <p className="text-sm text-gray-500 text-center py-6">
                Focused per-page intervals not available — this session predates
                per-page focus tracking.
              </p>
            ) : readingTimeView === "path" ? (
              pathStepsWithFocus === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">
                  No focused time recorded on any step (every visit was paused or idle).
                </p>
              ) : (
                <div className="space-y-1 max-h-[50vh] overflow-y-auto pr-1">
                  {pathSteps.map((step, idx) => {
                    const focused = step.focusedSeconds ?? 0;
                    const wall = step.durationSeconds;
                    const ch = getChapterForPage(step.pageNumber);
                    const barWidth = Math.max(2, (focused / maxPathFocusForBars) * 100);
                    const ratio = wall > 0 ? focused / wall : 0;
                    const distracted =
                      wall >= RATIO_MIN_WALLCLOCK_SEC && ratio < DISTRACTED_RATIO;
                    return (
                      <div
                        key={step.id}
                        className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-800/50 transition"
                      >
                        <span className="w-8 text-[10px] text-gray-600 text-right font-mono flex-shrink-0">
                          #{idx + 1}
                        </span>
                        <span className="w-14 text-xs text-gray-400 text-right font-mono flex-shrink-0">
                          p. {step.pageNumber}
                        </span>
                        {ch && (
                          <span className="text-[10px] text-gray-500 w-20 truncate flex-shrink-0" title={ch}>
                            {ch}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="h-4 rounded-full overflow-hidden bg-gray-800">
                            <div
                              className={`h-full rounded-full transition-all ${distracted ? "bg-amber-500/70" : "bg-emerald-500/70"}`}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </div>
                        <span className="w-16 text-xs text-gray-400 text-right flex-shrink-0">{fmtSeconds(focused)}</span>
                        <span
                          className={`text-[10px] w-12 text-right flex-shrink-0 ${
                            distracted ? "text-amber-400" : "text-gray-600"
                          }`}
                          title={
                            wall >= RATIO_MIN_WALLCLOCK_SEC
                              ? `${Math.round(ratio * 100)}% of wall clock (${fmtSeconds(wall)})`
                              : "wall-clock too short to score"
                          }
                        >
                          {wall >= RATIO_MIN_WALLCLOCK_SEC ? `${Math.round(ratio * 100)}%` : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )
            ) : pagesWithFocus === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">
                No focused time recorded on any page (every visit was paused or idle).
              </p>
            ) : (
              <div className="space-y-1 max-h-[50vh] overflow-y-auto pr-1">
                {uniquePages.map((pg) => {
                  const focused = focusedTimeMap.get(pg) ?? 0;
                  const wall = pageTimeMap.get(pg) ?? 0;
                  const ch = getChapterForPage(pg);
                  const maxF = Math.max(maxFocusOnAnyPage, 1);
                  const barWidth = Math.max(2, (focused / maxF) * 100);
                  const ratio = wall > 0 ? focused / wall : 0;
                  const distracted =
                    wall >= RATIO_MIN_WALLCLOCK_SEC && ratio < DISTRACTED_RATIO;
                  return (
                    <div
                      key={pg}
                      className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-gray-800/50 transition"
                    >
                      <span className="w-14 text-xs text-gray-400 text-right font-mono flex-shrink-0">p. {pg}</span>
                      {ch && <span className="text-[10px] text-gray-500 w-20 truncate flex-shrink-0" title={ch}>{ch}</span>}
                      <div className="flex-1 min-w-0">
                        <div className="h-4 rounded-full overflow-hidden bg-gray-800">
                          <div
                            className={`h-full rounded-full transition-all ${distracted ? "bg-amber-500/70" : "bg-emerald-500/70"}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                      <span className="w-16 text-xs text-gray-400 text-right flex-shrink-0">{fmtSeconds(focused)}</span>
                      <span
                        className={`text-[10px] w-12 text-right flex-shrink-0 ${
                          distracted ? "text-amber-400" : "text-gray-600"
                        }`}
                        title={
                          wall >= RATIO_MIN_WALLCLOCK_SEC
                            ? `${Math.round(ratio * 100)}% of wall clock (${fmtSeconds(wall)})`
                            : "wall-clock too short to score"
                        }
                      >
                        {wall >= RATIO_MIN_WALLCLOCK_SEC ? `${Math.round(ratio * 100)}%` : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Quiz performance */}
        {quiz && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 mb-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold">Quiz Performance</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {quiz.completed
                    ? `Completed — ${quiz.score ?? 0} / ${quiz.totalQuestions ?? quiz.questions.length} correct`
                    : `Generated — not yet completed (${quiz.totalQuestions ?? quiz.questions.length} questions)`}
                </p>
              </div>
              {quiz.accuracy != null && (
                <div className="flex-shrink-0 text-right">
                  <p className="text-2xl font-bold">{quiz.accuracy}%</p>
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">Accuracy</p>
                </div>
              )}
            </div>

            {quiz.questions.length > 0 && (
              <div className="space-y-1 max-h-[30vh] overflow-y-auto pr-1">
                {quiz.questions.map((q, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 py-1.5 px-2 rounded-lg hover:bg-gray-800/50 transition"
                  >
                    <span className="w-6 text-xs text-gray-500 text-right font-mono flex-shrink-0">
                      {i + 1}.
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-300 truncate" title={q.question}>
                        {q.question}
                      </p>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        Answer: {q.options[q.correctIndex] ?? "—"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Velocity performance */}
        {velocity && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 mb-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold">Velocity Performance</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {velocity.completed
                    ? `Completed — ${velocity.correctCount} / ${velocity.total} correct`
                    : `Generated — not yet played (${velocity.total} questions)`}
                </p>
              </div>
              {velocity.accuracy != null && (
                <div className="flex-shrink-0 text-right">
                  {typeof velocity.score === "number" && (
                    <p className="text-2xl font-bold">
                      {velocity.score >= 0 ? `+${velocity.score}` : velocity.score}
                    </p>
                  )}
                  <p className="text-[10px] uppercase tracking-wide text-gray-500">
                    {typeof velocity.score === "number"
                      ? `${velocity.accuracy}% accuracy`
                      : "Accuracy"}
                    {typeof velocity.score !== "number" && (
                      <span className="block text-lg font-bold text-white">{velocity.accuracy}%</span>
                    )}
                  </p>
                  {(velocity.negCount != null && velocity.negCount > 0) && (
                    <p className="text-[10px] text-red-400 mt-0.5">{velocity.negCount} neg</p>
                  )}
                  {(velocity.streakBest != null && velocity.streakBest >= 2) && (
                    <p className="text-[10px] text-amber-400 mt-0.5">🔥 best {velocity.streakBest}</p>
                  )}
                </div>
              )}
            </div>

            {velocity.completed && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="rounded-lg border border-gray-800 bg-gray-950 p-2 text-center">
                  <p className="text-sm font-bold">
                    {velocity.avgReactionMs != null
                      ? `${(velocity.avgReactionMs / 1000).toFixed(2)}s`
                      : "—"}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Avg reaction</p>
                </div>
                <div className="rounded-lg border border-gray-800 bg-gray-950 p-2 text-center">
                  <p className="text-sm font-bold">
                    {velocity.fastestMs != null
                      ? `${(velocity.fastestMs / 1000).toFixed(2)}s`
                      : "—"}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Fastest</p>
                </div>
                <div className="rounded-lg border border-gray-800 bg-gray-950 p-2 text-center">
                  <p className="text-sm font-bold">
                    {velocity.slowestMs != null
                      ? `${(velocity.slowestMs / 1000).toFixed(2)}s`
                      : "—"}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Slowest</p>
                </div>
              </div>
            )}

            {velocity.attempts.length > 0 && (
              <div className="space-y-0.5 max-h-[30vh] overflow-y-auto pr-1">
                {velocity.attempts.map((a, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 py-1.5 px-2 rounded-lg hover:bg-gray-800/50 transition"
                  >
                    <span className="w-6 text-xs text-gray-500 text-right font-mono flex-shrink-0">
                      {i + 1}.
                    </span>
                    <span
                      className={`w-4 text-xs text-center flex-shrink-0 ${
                        a.correct ? "text-green-500" : "text-red-400"
                      }`}
                      aria-hidden
                    >
                      {a.correct ? "✓" : "✗"}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-gray-600 w-7 flex-shrink-0">
                      {a.type}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-300 truncate" title={a.question}>
                        {a.question}
                      </p>
                      <p className="text-[10px] text-gray-500 mt-0.5 truncate">
                        <span className="text-gray-600">Topic:</span> {a.topic}
                        {a.userAnswer != null && (
                          <>
                            {" · "}
                            <span className="text-gray-600">User:</span>{" "}
                            <span className={a.correct ? "text-green-500/80" : "text-red-400/80"}>
                              &ldquo;{a.userAnswer || "(blank)"}&rdquo;
                            </span>
                          </>
                        )}
                        {!a.correct && (
                          <>
                            {" · "}
                            <span className="text-gray-600">Correct:</span>{" "}
                            <span className="text-gray-400">{a.correctAnswer}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <span className="text-[10px] font-mono text-gray-500 flex-shrink-0 w-12 text-right">
                      {a.reactionMs != null ? `${(a.reactionMs / 1000).toFixed(2)}s` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {(() => {
              const reviewObj = velocity.review as
                | { growthAreas?: { topic: string; tip: string }[] }
                | null
                | undefined;
              const growthAreas = reviewObj?.growthAreas;
              if (!Array.isArray(growthAreas) || growthAreas.length === 0) return null;
              return (
                <div className="mt-4 pt-3 border-t border-gray-800">
                  <p className="text-xs font-semibold mb-2 text-gray-400">Growth areas</p>
                  <ul className="space-y-1.5">
                    {growthAreas.map((g, i) => (
                      <li key={i} className="flex gap-2 text-xs">
                        <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-amber-500" />
                        <div>
                          <span className="text-gray-300 font-medium">{g.topic}</span>
                          <span className="text-gray-500"> — {g.tip}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </div>
        )}

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
    const chartDays = userSessions ? buildStudyChartDays(userSessions, studyChartRange) : [];
    const chartTotalMinutes = chartDays.reduce((s, d) => s + d.minutes, 0);
    const chartSessionCount = chartDays.reduce((s, d) => s + d.sessions, 0);
    const maxChartMinutes = Math.max(...chartDays.map((d) => d.minutes), 1);
    const chartTodayStr = new Date().toISOString().slice(0, 10);
    const studyMinutesData = userSessions ? buildMinutesByDay(userSessions) : null;
    const calendarBounds =
      studyMinutesData && studyChartRange !== "7"
        ? getStudyCalendarBounds()
        : null;
    const activeInProgress = (userSessions ?? []).filter((s) => !s.endedAt);
    const activeFocusedMinutes = activeInProgress.reduce(
      (sum, s) => sum + (s.totalFocusedMinutes ?? 0),
      0
    );

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
            {!selectedUser.isSuperAdmin && (
              <button
                onClick={() => setConfirmBan(selectedUser)}
                className="rounded-md border border-red-800 px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 transition"
              >
                Ban user
              </button>
            )}
          </div>
        </div>

        <div className="flex rounded-lg border border-gray-700 p-0.5 text-xs w-fit mb-5">
          <button
            type="button"
            onClick={() => setUserDetailTab("overview")}
            className={`rounded-md px-3 py-1.5 transition ${
              userDetailTab === "overview"
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setUserDetailTab("ai-usage")}
            className={`rounded-md px-3 py-1.5 transition ${
              userDetailTab === "ai-usage"
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            AI usage
          </button>
        </div>

        {userDetailTab === "ai-usage" ? (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 mb-5">
            <h3 className="text-sm font-semibold mb-3">AI usage log</h3>
            <UserAiUsageLog
              userId={selectedUser.id}
              lifetimeTokensUsed={userAiTokensUsed}
            />
          </div>
        ) : (
          <>
        {/* Study time by day */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 mb-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-semibold">Study time by day</h3>
            <div className="flex rounded-lg border border-gray-700 p-0.5 text-xs">
              {(
                [
                  ["7", "7 days"],
                  ["30", "Month"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStudyChartRange(value)}
                  className={`rounded-md px-2.5 py-1 transition whitespace-nowrap ${
                    studyChartRange === value
                      ? "bg-gray-700 text-white"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {!userSessions ? (
            <p className="text-sm text-gray-500 animate-pulse py-6 text-center">Loading chart…</p>
          ) : chartSessionCount === 0 && chartTotalMinutes === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">No completed study sessions in this period.</p>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-3">
                {fmtHmsFromMinutes(chartTotalMinutes)} total · {chartSessionCount} session
                {chartSessionCount !== 1 ? "s" : ""} in range
              </p>
              {studyChartRange === "7" ? (
                <div className="overflow-x-auto pb-1">
                  <div
                    className="flex items-end gap-1"
                    style={{ minWidth: `${Math.max(chartDays.length * 44, 280)}px` }}
                  >
                    {chartDays.map((day) => {
                      const barPx =
                        day.minutes > 0
                          ? Math.max(
                              (day.minutes / maxChartMinutes) * STUDY_CHART_BAR_MAX_PX,
                              STUDY_CHART_MIN_BAR_PX
                            )
                          : 0;
                      const isToday = day.date === chartTodayStr;
                      const dayLabel = new Date(day.date + "T12:00:00").toLocaleDateString(
                        undefined,
                        { weekday: "short" }
                      );
                      return (
                        <div
                          key={day.date}
                          className="flex flex-col items-center gap-1 flex-1 min-w-[2.5rem]"
                        >
                          <span className="text-[10px] font-mono text-gray-500 min-h-[0.875rem] whitespace-nowrap">
                            {day.minutes > 0 ? fmtHmsFromMinutes(day.minutes) : ""}
                          </span>
                          <div
                            className="w-full flex justify-center items-end"
                            style={{ height: STUDY_CHART_BAR_MAX_PX }}
                          >
                            <div
                              className={`w-full max-w-[2rem] rounded-t-md transition-all ${
                                isToday ? "bg-blue-500" : "bg-gray-700"
                              }`}
                              style={{ height: barPx }}
                              title={
                                day.minutes > 0
                                  ? `${fmtHmsFromMinutes(day.minutes)} · ${day.sessions} session${day.sessions !== 1 ? "s" : ""}`
                                  : undefined
                              }
                            />
                          </div>
                          <span
                            className={`text-[10px] whitespace-nowrap ${
                              isToday ? "font-bold text-white" : "text-gray-500"
                            }`}
                          >
                            {dayLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : studyMinutesData && calendarBounds ? (
                <AdminStudyCalendar
                  minutesByDay={studyMinutesData.minutesByDay}
                  year={studyCalendarYear}
                  month={studyCalendarMonth}
                  onMonthChange={(y, m) => {
                    setStudyCalendarYear(y);
                    setStudyCalendarMonth(m);
                  }}
                  minYear={calendarBounds.minYear}
                  minMonth={calendarBounds.minMonth}
                  maxYear={calendarBounds.maxYear}
                  maxMonth={calendarBounds.maxMonth}
                  fmtHms={fmtHmsFromMinutes}
                />
              ) : null}
            </>
          )}
          {activeInProgress.length > 0 && (
            <p className="text-[10px] text-amber-500/90 mt-3">
              Active now — {fmtHmsFromMinutes(activeFocusedMinutes)} focused (not in chart until
              completed)
            </p>
          )}
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

        {/* AI token usage + limit */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 mb-5">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h3 className="text-sm font-semibold mb-1">AI token usage</h3>
              <p className="text-xs text-gray-500">
                Lifetime prompt + completion tokens this user has spent across every AI feature (notes, quizzes, flashcards, videos, Velocity generation + grading).
              </p>
            </div>
            {selectedUser.aiTokenLimitEffective != null && (
              <span
                className={`text-xs font-mono whitespace-nowrap px-2 py-1 rounded ${
                  userAiTokensUsed >= selectedUser.aiTokenLimitEffective
                    ? "bg-red-900/50 text-red-300"
                    : userAiTokensUsed / selectedUser.aiTokenLimitEffective > 0.75
                      ? "bg-amber-900/50 text-amber-300"
                      : "bg-gray-800 text-gray-300"
                }`}
              >
                {userAiTokensUsed.toLocaleString()} / {selectedUser.aiTokenLimitEffective.toLocaleString()}
              </span>
            )}
            {selectedUser.aiTokenLimitEffective == null && (
              <span className="text-xs font-mono whitespace-nowrap px-2 py-1 rounded bg-gray-800 text-gray-300">
                {userAiTokensUsed.toLocaleString()} / unlimited
              </span>
            )}
          </div>

          {selectedUser.aiTokenLimitEffective != null && (
            <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-gray-950">
              <div
                className={`h-full transition-[width] ${
                  userAiTokensUsed >= selectedUser.aiTokenLimitEffective
                    ? "bg-red-500"
                    : userAiTokensUsed / selectedUser.aiTokenLimitEffective > 0.75
                      ? "bg-amber-400"
                      : "bg-green-500"
                }`}
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(0, (userAiTokensUsed / selectedUser.aiTokenLimitEffective) * 100)
                  )}%`,
                }}
              />
            </div>
          )}

          <p className="text-xs text-gray-500 mb-2">
            Per-user token limit. Leave blank to fall back to the deploy-level default. When a user reaches their limit, new AI calls return a 429 and the UI shows &quot;Contact an admin&quot;.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="number"
              min={1}
              step={1000}
              value={userAiTokenLimit}
              onChange={(e) => setUserAiTokenLimit(e.target.value)}
              placeholder="e.g. 500000"
              className="w-40 rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm"
            />
            <span className="text-xs text-gray-500">tokens</span>
            <button
              onClick={async () => {
                if (!selectedUser) return;
                setSavingAiTokenLimit(true);
                try {
                  const limit = userAiTokenLimit === "" ? null : Number(userAiTokenLimit);
                  await fetch(`/api/admin/users/${selectedUser.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ aiTokenLimit: limit }),
                  });
                  setUsers((prev) =>
                    prev?.map((u) =>
                      u.id === selectedUser.id
                        ? { ...u, aiTokenLimit: limit, aiTokenLimitEffective: limit ?? u.aiTokenLimitEffective ?? null }
                        : u
                    ) ?? null
                  );
                } finally {
                  setSavingAiTokenLimit(false);
                }
              }}
              disabled={savingAiTokenLimit}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
            >
              {savingAiTokenLimit ? "Saving…" : "Save limit"}
            </button>
            {userAiTokenLimit !== "" && (
              <button
                onClick={async () => {
                  if (!selectedUser) return;
                  setUserAiTokenLimit("");
                  setSavingAiTokenLimit(true);
                  try {
                    await fetch(`/api/admin/users/${selectedUser.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ aiTokenLimit: null }),
                    });
                    setUsers((prev) =>
                      prev?.map((u) => (u.id === selectedUser.id ? { ...u, aiTokenLimit: null } : u)) ?? null
                    );
                  } finally {
                    setSavingAiTokenLimit(false);
                  }
                }}
                className="text-xs text-gray-400 hover:underline"
              >
                Reset to default
              </button>
            )}
            <button
              onClick={async () => {
                if (!selectedUser) return;
                if (!confirm(`Reset ${selectedUser.email}'s AI token counter to 0?`)) return;
                setResettingAiTokens(true);
                try {
                  await fetch(`/api/admin/users/${selectedUser.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ resetAiTokens: true }),
                  });
                  setUserAiTokensUsed(0);
                  setUsers((prev) =>
                    prev?.map((u) => (u.id === selectedUser.id ? { ...u, aiTokensUsed: 0 } : u)) ?? null
                  );
                } finally {
                  setResettingAiTokens(false);
                }
              }}
              disabled={resettingAiTokens}
              className="ml-auto text-xs text-red-400 hover:underline disabled:opacity-50"
            >
              {resettingAiTokens ? "Resetting…" : "Reset counter"}
            </button>
          </div>
        </div>

        {/* Storage quota override */}
        <div className="bg-gray-900 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-semibold mb-2">Storage quota override</h3>
          <p className="text-xs text-gray-500 mb-3">
            Default is 350 MB. Set a custom limit for this user (in MB). Leave blank to reset to default.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={userStorageQuotaMB}
              onChange={(e) => setUserStorageQuotaMB(e.target.value)}
              placeholder="350"
              className="w-28 rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm"
            />
            <span className="text-xs text-gray-500">MB</span>
            <button
              onClick={async () => {
                if (!selectedUser) return;
                const mb = userStorageQuotaMB === "" ? null : Number(userStorageQuotaMB) * 1024 * 1024;
                await fetch(`/api/admin/users/${selectedUser.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ storageQuotaBytes: mb }),
                });
              }}
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black"
            >
              Save
            </button>
            {userStorageQuotaMB !== "" && (
              <button
                onClick={async () => {
                  if (!selectedUser) return;
                  setUserStorageQuotaMB("");
                  await fetch(`/api/admin/users/${selectedUser.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ storageQuotaBytes: null }),
                  });
                }}
                className="text-xs text-red-400 hover:underline"
              >
                Reset to default
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
          </>
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
          <BanModal user={confirmBan} banning={banning} banBlacklist={banBlacklist} setBanBlacklist={setBanBlacklist} onCancel={() => { setConfirmBan(null); setBanBlacklist(true); }} onConfirm={() => banUser(confirmBan)} />
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
              {["User", "Role", "Joined", "Sessions", "Study Time", "AI Tokens", "Last Active", ""].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No users found.</td></tr>
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
                <td className="px-4 py-3 text-xs font-mono">
                  {(() => {
                    const used = user.aiTokensUsed ?? 0;
                    const limit = user.aiTokenLimitEffective;
                    if (limit == null) {
                      return <span className="text-gray-400">{used.toLocaleString()}</span>;
                    }
                    const pct = limit > 0 ? used / limit : 0;
                    const color = pct >= 1 ? "text-red-400" : pct > 0.75 ? "text-amber-400" : "text-gray-300";
                    return (
                      <span className={color} title={`${used.toLocaleString()} / ${limit.toLocaleString()}`}>
                        {used.toLocaleString()}<span className="text-gray-600"> / {limit.toLocaleString()}</span>
                      </span>
                    );
                  })()}
                </td>
                <td className="px-4 py-3 text-gray-400">
                  {user.lastActiveAt ? new Date(user.lastActiveAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "Never"}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => void viewAsUser(user)}
                      disabled={viewAsLoading === user.id}
                      className="rounded-md border border-cyan-800 px-3 py-1 text-xs text-cyan-400 hover:bg-cyan-900/30 transition disabled:opacity-40"
                      title="Open the app as this user (dashboard, study, settings)"
                    >
                      {viewAsLoading === user.id ? "…" : "View as"}
                    </button>
                    <button
                      onClick={() => openUserDetail(user)}
                      className="rounded-md border border-gray-600 px-3 py-1 text-xs text-gray-400 hover:bg-gray-800 transition"
                    >
                      Manage
                    </button>
                    {!user.isSuperAdmin && (
                      <button
                        onClick={() => setConfirmBan(user)}
                        disabled={banning === user.id}
                        className="rounded-md border border-red-800 px-3 py-1 text-xs text-red-400 hover:bg-red-900/30 transition disabled:opacity-40"
                      >
                        Ban
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-600 text-center">Banning permanently deletes all account data and blacklists the email.</p>

      {/* Banned emails section */}
      <div className="mt-6">
        <button
          onClick={() => setShowBanned((v) => !v)}
          className="text-xs text-gray-500 hover:text-gray-300 underline underline-offset-4 transition"
        >
          {showBanned ? "Hide" : "Show"} banned emails ({bannedList.length})
        </button>

        {showBanned && (
          <div className="mt-3 rounded-xl border border-gray-800 bg-gray-900 p-4">
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="Add email to blacklist…"
                value={newBanEmail}
                onChange={(e) => setNewBanEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addBannedEmail()}
                className="flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />
              <button
                onClick={addBannedEmail}
                disabled={addingBan || !newBanEmail.trim()}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium hover:bg-red-700 transition disabled:opacity-40"
              >
                {addingBan ? "…" : "Blacklist"}
              </button>
            </div>
            {bannedList.length === 0 ? (
              <p className="text-xs text-gray-600 text-center py-2">No banned emails.</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-auto">
                {bannedList.map((b) => (
                  <div key={b.email} className="flex items-center justify-between gap-2 rounded-lg bg-gray-950 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{b.email}</p>
                      <p className="text-[10px] text-gray-600">
                        {b.bannedAt ? new Date(b.bannedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""}
                        {b.bannedBy ? ` by ${b.bannedBy}` : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => removeBannedEmail(b.email)}
                      className="flex-shrink-0 rounded-md border border-gray-700 px-2 py-1 text-[10px] text-gray-500 hover:text-white hover:border-gray-500 transition"
                    >
                      Unban
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {confirmBan && (
        <BanModal user={confirmBan} banning={banning} banBlacklist={banBlacklist} setBanBlacklist={setBanBlacklist} onCancel={() => { setConfirmBan(null); setBanBlacklist(true); }} onConfirm={() => banUser(confirmBan)} />
      )}
    </>
  );
}

function BanModal({ user, banning, banBlacklist, setBanBlacklist, onCancel, onConfirm }: {
  user: UserRow; banning: string | null; banBlacklist: boolean;
  setBanBlacklist: (v: boolean) => void; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-700 p-6 shadow-2xl">
        <h2 className="text-base font-semibold mb-1">Ban this user?</h2>
        <p className="text-sm text-gray-400 mb-1"><span className="text-white font-medium">{user.email}</span></p>
        <p className="text-sm text-gray-500 mb-4">This will permanently delete their account, sessions, notes, and quiz data. Cannot be undone.</p>
        <label className="flex items-center gap-2 mb-5 cursor-pointer">
          <input
            type="checkbox"
            checked={banBlacklist}
            onChange={(e) => setBanBlacklist(e.target.checked)}
            className="rounded border-gray-600"
          />
          <span className="text-sm text-gray-400">Blacklist email (prevent re-signup)</span>
        </label>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 transition">Cancel</button>
          <button onClick={onConfirm} disabled={banning === user.id} className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium hover:bg-red-700 transition disabled:opacity-50">
            {banning === user.id ? "Banning…" : "Yes, ban them"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Debug logs (client errors) ──────────────────────────────────────────────

interface DebugLogRow {
  id: string;
  createdAt: string | null;
  userId: string | null;
  email: string | null;
  userName: string | null;
  message: string;
  stack: string | null;
  url: string | null;
  userAgent: string | null;
  extra: unknown;
}

function DebugLogEntryList({ entries, emptyLabel }: { entries: DebugLogRow[]; emptyLabel: string }) {
  if (entries.length === 0) {
    return <p className="text-sm text-gray-500 py-2">{emptyLabel}</p>;
  }
  return (
    <div className="space-y-3 max-h-[min(50vh,28rem)] overflow-auto pr-1">
      {entries.map((entry) => (
        <details
          key={entry.id}
          className="rounded-xl border border-gray-800 bg-gray-900/80 px-4 py-3 text-sm group"
        >
          <summary className="cursor-pointer list-none flex flex-wrap gap-x-3 gap-y-1 [&::-webkit-details-marker]:hidden">
            <span className="font-mono text-[11px] text-gray-500 shrink-0">
              {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "—"}
            </span>
            <span className="text-gray-300 break-words flex-1 min-w-[12rem]">{entry.message}</span>
          </summary>
          <div className="mt-3 space-y-2 text-xs text-gray-400 border-t border-gray-800 pt-3">
            {(entry.userName || entry.email || entry.userId) && (
              <p>
                <span className="text-gray-600">User:</span>{" "}
                <span className="text-gray-200">
                  {entry.userName ? (
                    <>
                      {entry.userName}
                      {entry.email ? (
                        <span className="text-gray-500"> ({entry.email})</span>
                      ) : null}
                    </>
                  ) : entry.email ? (
                    entry.email
                  ) : (
                    <span className="text-gray-500">id {entry.userId}</span>
                  )}
                </span>
              </p>
            )}
            {entry.url && (
              <p className="break-all">
                <span className="text-gray-600">URL:</span> {entry.url}
              </p>
            )}
            {entry.userAgent && (
              <p className="break-all opacity-80">
                <span className="text-gray-600">UA:</span> {entry.userAgent}
              </p>
            )}
            {entry.stack && (
              <pre className="whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 text-[11px] text-gray-300 max-h-48 overflow-auto">
                {entry.stack}
              </pre>
            )}
            {entry.extra != null && (
              <pre className="whitespace-pre-wrap break-all rounded-lg bg-black/40 p-3 text-[11px] text-gray-400 max-h-32 overflow-auto">
                {typeof entry.extra === "string"
                  ? entry.extra
                  : JSON.stringify(entry.extra, null, 2)}
              </pre>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

function DebugLogsTab() {
  const [userLogs, setUserLogs] = useState<DebugLogRow[] | null>(null);
  const [devLogs, setDevLogs] = useState<DebugLogRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/debug-logs?limit=100");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.error ?? "Could not load logs");
        setUserLogs([]);
        setDevLogs([]);
        return;
      }
      setUserLogs(data.userLogs ?? []);
      setDevLogs(data.devLogs ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm hover:bg-gray-800 transition disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
        <p className="text-xs text-gray-500">
          Owner only. User errors from <code className="text-gray-400">/api/debug/client-error</code>; dev lines from{" "}
          <code className="text-gray-400">reportDevDebug()</code> / <code className="text-gray-400">/api/debug/dev-log</code>.
        </p>
      </div>

      {loadError && (
        <p className="text-sm text-red-400">{loadError}</p>
      )}

      <section>
        <h2 className="text-sm font-semibold text-white mb-2 border-b border-gray-800 pb-2">
          User errors
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          Automatic browser errors with username and email when available. Newest first.
        </p>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <DebugLogEntryList entries={userLogs ?? []} emptyLabel="No user errors yet." />
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-white mb-2 border-b border-gray-800 pb-2">
          Developer debug
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          Feature work: call <code className="text-gray-400">reportDevDebug(&quot;message&quot;, optionalData)</code> from{" "}
          <code className="text-gray-400">lib/dev-debug.ts</code> while signed in as owner.
        </p>
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <DebugLogEntryList entries={devLogs ?? []} emptyLabel="No developer debug entries yet." />
        )}
      </section>
    </div>
  );
}

// ── Upload Tab ─────────────────────────────────────────────────────────────

interface UploadLogEntry {
  /** Wall-clock time of the FIRST time this dedupe key was logged. */
  time: string;
  /** `pct|label` — events with the same key collapse into one line. */
  dedupeKey: string;
  /** Human label, e.g. "Uploading… 50%" or "Stalled — no progress…". */
  label: string;
  /** Latest byte counts for live-updating progress lines. */
  bytes?: { loaded: number; total: number };
  /** How many times this line was repeated (for non-byte status lines). */
  count: number;
}

function formatUploadLogEntry(e: UploadLogEntry): string {
  const bytes = e.bytes ? ` (${fmtUploadBytes(e.bytes.loaded, e.bytes.total)})` : "";
  const count = e.count > 1 ? ` (×${e.count})` : "";
  return `${e.time}: ${e.label}${bytes}${count}`;
}

function fmtUploadBytes(loaded: number, total: number): string {
  const fmt = (b: number) => `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${fmt(loaded)} / ${fmt(total)}`;
}

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

  // ── AI table-of-contents extraction ──────────────────────────────
  // Runs after the PDF lands in storage. Pre-populates the visual
  // TOC editor below so the admin can review/edit/delete chapters
  // before committing the catalog row. Failures never block saving.
  type TocExtractStatus = "idle" | "running" | "found" | "empty" | "error";
  const [tocExtractStatus, setTocExtractStatus] = useState<TocExtractStatus>("idle");
  const [tocExtractMessage, setTocExtractMessage] = useState<string | null>(null);
  /**
   * True once the file upload + AI extraction step have finished but
   * the admin hasn't yet committed the catalog row. Gates the
   * "Save to catalog" button so the catalog write only happens after
   * the admin has had a chance to review the extracted TOC.
   */
  const [awaitingCatalogReview, setAwaitingCatalogReview] = useState(false);
  const [savingCatalog, setSavingCatalog] = useState(false);
  // Smart upload log. Each entry is structured so the renderer can
  // dedupe consecutive identical (pct, label) events into one line +
  // live-update its byte counter. Without dedupe a 200 MB upload
  // produces hundreds of identical "Uploading… 50%" rows that hide
  // any actually-useful events.
  const [debugLog, setDebugLog] = useState<UploadLogEntry[]>([]);
  const addLog = (
    label: string,
    opts?: { pct?: number; bytes?: { loaded: number; total: number } }
  ) =>
    setDebugLog((prev) => {
      const time = new Date().toLocaleTimeString();
      // Dedupe key = (pct, label). Two events with the same key but
      // different byte counts are treated as updates to the same
      // line, so the user can see actual byte movement even when the
      // rounded percentage label is stuck on the same value for many
      // progress events in a row.
      const dedupeKey = `${opts?.pct ?? "_"}|${label}`;
      const last = prev[prev.length - 1];
      if (last && last.dedupeKey === dedupeKey) {
        const updated: UploadLogEntry = {
          ...last,
          // When the event carries bytes, the user wants live bytes
          // (data is moving). When it doesn't, the event is just a
          // status line repeating itself — bump a `(×N)` counter
          // instead so the row collapses cleanly.
          bytes: opts?.bytes ?? last.bytes,
          count: opts?.bytes ? last.count : last.count + 1,
        };
        return [...prev.slice(0, -1), updated];
      }
      return [
        ...prev,
        {
          time,
          dedupeKey,
          label,
          bytes: opts?.bytes,
          count: 1,
        },
      ];
    });

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

    setStatus("uploading");
    setError(null);
    setProgress(0);
    setDebugLog([]);
    setTocExtractStatus("idle");
    setTocExtractMessage(null);
    setAwaitingCatalogReview(false);

    const filename = file.name.replace(/\s+/g, "_");
    const slug = identifier || `bowlbeacon-${slugify(title)}`;
    const blobPathname = `public/${slug}/${filename}`;

    addLog(`Starting upload: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);

    let blobUrl: string;
    try {
      blobUrl = await uploadPdfToStorage(file, blobPathname, (pct, label, bytes) => {
        setProgress(pct);
        // The button label must stay just `Uploading… N%` — the bytes
        // column is debug-log only. `label` already excludes bytes.
        setStatusLabel(label);
        // Log every progress event so the dedupe logger can update the
        // live bytes counter in place. Previously we only logged at
        // pct === 2 or pct % 25, which produced a sparse log that gave
        // no information about whether bytes were actually moving
        // between those milestones — making "stalled at 75%" look
        // identical to "uploading at 75%".
        addLog(label, { pct, bytes });
      }, { admin: true });
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

    if (addToCatalog) {
      // Don't auto-save the catalog any more — we want the admin to
      // review the AI-extracted TOC first. Land on the "review"
      // screen with the upload complete + AI extraction running. The
      // catalog write happens when the admin clicks "Save to
      // catalog" below.
      setStatusLabel("Scanning PDF for table of contents…");
      setProgress(95);
      setStatus("done");
      setProgress(100);
      setAwaitingCatalogReview(true);
      // Fire-and-forget — `runTocExtraction` manages its own status
      // state. The admin can edit the TocEditor in parallel and even
      // hit "Save to catalog" before extraction settles if they want.
      void runTocExtraction(blobUrl);
      return;
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
    setTocExtractStatus("idle");
    setTocExtractMessage(null);
    setAwaitingCatalogReview(false);
    setSavingCatalog(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  /**
   * POST /api/admin/extract-toc with the uploaded PDF's URL. On
   * success populates the visual TOC editor with the extracted
   * chapters + page offset; on failure shows an inline message but
   * never blocks the catalog save (the editor stays editable so the
   * admin can type the TOC by hand if AI can't find one). Every
   * branch also writes a line to the upload debug log so the admin
   * can see what happened end-to-end.
   */
  async function runTocExtraction(pdfUrl: string) {
    setTocExtractStatus("running");
    setTocExtractMessage(null);
    addLog("Scanning PDF for table of contents…");
    try {
      const res = await fetch("/api/admin/extract-toc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail =
          (data && typeof data.error === "string" && data.error) ||
          `HTTP ${res.status}`;
        setTocExtractStatus("error");
        setTocExtractMessage(detail);
        addLog(`AI TOC extract failed: ${detail}`);
        return;
      }
      const ranges = (data?.ranges ?? {}) as Record<string, [number, number]>;
      const offset = typeof data?.pageOffset === "number" ? data.pageOffset : 0;
      const foundToc = data?.foundToc === true;
      const reason = typeof data?.reason === "string" ? data.reason : "";
      if (!foundToc || Object.keys(ranges).length === 0) {
        setTocExtractStatus("empty");
        setTocExtractMessage(
          reason || "AI couldn't find a table of contents in this PDF."
        );
        addLog(`AI TOC extract: no chapters found${reason ? ` (${reason})` : ""}`);
        return;
      }
      const newRows = rangesToTocRows(ranges, offset);
      setPageOffset(offset);
      setTocRows(newRows);
      setTocExtractStatus("found");
      setTocExtractMessage(
        `AI extracted ${newRows.length} chapter${
          newRows.length === 1 ? "" : "s"
        } with offset ${offset} — please review before saving.`
      );
      addLog(
        `AI TOC extract: ${newRows.length} chapter${
          newRows.length === 1 ? "" : "s"
        }, offset ${offset}`
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown error";
      setTocExtractStatus("error");
      setTocExtractMessage(detail);
      addLog(`AI TOC extract failed: ${detail}`);
    }
  }

  /**
   * Commit the catalog row using whatever's currently in the visual
   * TOC editor. Called from the new "Save to catalog" button that
   * shows up after upload + extraction so the admin always has a
   * chance to review the AI's chapter list before it lands in the
   * public catalog.
   */
  async function handleSaveCatalogAfterReview() {
    if (!archiveUrl || !title) return;
    setSavingCatalog(true);
    setError(null);
    const slug = identifier || `bowlbeacon-${slugify(title)}`;
    const parsedChapters = tocRowsToRanges(tocRows, pageOffset);
    try {
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
        addLog("Catalog save failed");
        return;
      }
      setAwaitingCatalogReview(false);
      addLog("Catalog row saved");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save catalog row";
      setError(msg);
      addLog(`Catalog save failed: ${msg}`);
    } finally {
      setSavingCatalog(false);
    }
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
          {addToCatalog && !awaitingCatalogReview && (
            <p className="text-sm text-gray-400">Added to the textbook catalog — users can now find it in the document picker.</p>
          )}

          {/* Post-upload TOC review for catalog uploads. The PDF is in
              storage; the AI is scanning the front matter for a TOC.
              Admin can edit/delete rows then click "Save to catalog". */}
          {addToCatalog && awaitingCatalogReview && (
            <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-4 space-y-3 mt-2">
              <p className="text-sm font-medium text-gray-300">Review table of contents</p>
              <p className="text-xs text-gray-500">
                The PDF is uploaded. Review the TOC below — AI tried to fill it in for you —
                then save the catalog row.
              </p>

              {/* AI extraction status banner. One of: running, found, empty, error. */}
              {tocExtractStatus === "running" && (
                <p className="text-xs text-blue-300 rounded-md border border-blue-800 bg-blue-900/20 px-3 py-2 animate-pulse">
                  Scanning PDF for table of contents…
                </p>
              )}
              {tocExtractStatus === "found" && tocExtractMessage && (
                <p className="text-xs text-green-300 rounded-md border border-green-800 bg-green-900/20 px-3 py-2">
                  {tocExtractMessage}
                </p>
              )}
              {tocExtractStatus === "empty" && (
                <p className="text-xs text-gray-300 rounded-md border border-gray-700 bg-gray-800/40 px-3 py-2">
                  {tocExtractMessage || "AI couldn't find a table of contents in this PDF."} You can enter it manually below.
                </p>
              )}
              {tocExtractStatus === "error" && (
                <p className="text-xs text-red-300 rounded-md border border-red-800 bg-red-900/20 px-3 py-2">
                  Auto-extract failed: {tocExtractMessage || "Unknown error"}. You can still enter the TOC manually and save.
                </p>
              )}

              <TocEditor
                variant="admin"
                rows={tocRows}
                onChange={setTocRows}
                pageOffset={pageOffset}
                onPageOffsetChange={setPageOffset}
              />
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                onClick={handleSaveCatalogAfterReview}
                disabled={savingCatalog || !title}
                className="w-full rounded-lg bg-white text-black py-2 text-sm font-semibold hover:bg-gray-200 transition disabled:opacity-40"
              >
                {savingCatalog ? "Saving…" : "Save to catalog"}
              </button>
            </div>
          )}

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
                  variant="admin"
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
                  variant="admin"
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
                {debugLog.map(formatUploadLogEntry).join("\n")}
              </pre>
            </details>
          )}

          <button
            onClick={handleUpload}
            disabled={status === "uploading" || !file || !title}
            className="w-full rounded-lg bg-white text-black py-2.5 text-sm font-semibold hover:bg-gray-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {/* statusLabel already includes the % (set by uploadPdfToStorage), so
                do NOT append `${progress}%` again — otherwise the button reads
                e.g. "Uploading… 14% 14%". Fall back to a synthesized label only
                when statusLabel is empty. */}
            {status === "uploading" ? (statusLabel || `Uploading… ${progress}%`) : "Upload & store"}
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
                variant="admin"
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
  /** Which backend currently hosts this blob (filled in by the API). */
  backend?: "r2";
  documentId: string | null;
  documentTitle: string | null;
  documentSourceType: string | null;
  uploader: { id: string; name: string | null; email: string } | null;
}

function isPdfBlobPathname(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  try {
    const last = decodeURIComponent(lower.split("/").pop() ?? "");
    return last.endsWith(".pdf");
  } catch {
    return lower.endsWith(".pdf");
  }
}

function StorageTab() {
  const [blobs, setBlobs] = useState<BlobItem[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [bucketName, setBucketName] = useState<string | null>(null);
  const [objectCount, setObjectCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BlobItem | null>(null);
  /** When set, an overlay shows this blob in an iframe (PDF) or opens a new tab (non-PDF). */
  const [previewBlob, setPreviewBlob] = useState<BlobItem | null>(null);
  const [filter, setFilter] = useState<"all" | "user" | "admin">("all");
  const [cleaning, setCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState<{
    deletedDocumentRows: number; clearedCatalogCaches: number; estimatedFreedFormatted: string;
  } | null>(null);

  async function runCleanup() {
    if (!confirm("This will delete all per-user catalog PDF blobs and the global catalog cache blobs from object storage. Catalog books will be served via proxy instead. Continue?")) return;
    setCleaning(true);
    setCleanResult(null);
    const res = await fetch("/api/admin/catalog/cleanup-blobs", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      setCleanResult(data);
      load(); // refresh blob list
    } else {
      alert(data.error ?? "Cleanup failed");
    }
    setCleaning(false);
  }
  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/blobs");
    if (res.ok) {
      const data = await res.json();
      setBlobs(data.blobs);
      setTotalSize(data.totalSize ?? 0);
      setBucketName(typeof data.bucketName === "string" ? data.bucketName : null);
      setObjectCount(typeof data.objectCount === "number" ? data.objectCount : data.blobs?.length ?? 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!previewBlob) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewBlob(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewBlob]);

  /** Authenticated same-origin URL so private blobs and Safari iframe PDF work. */
  function blobPdfServeSrc(blob: BlobItem): string {
    return `/api/blob/serve?url=${encodeURIComponent(blob.url)}`;
  }

  function openBlobPreview(blob: BlobItem) {
    if (isPdfBlobPathname(blob.pathname)) {
      setPreviewBlob(blob);
    } else {
      window.open(blob.url, "_blank", "noopener,noreferrer");
    }
  }

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

  const isUserUpload = (b: BlobItem) => b.documentSourceType === "upload" || b.pathname.startsWith("uploads/");
  const isAdminUpload = (b: BlobItem) => b.pathname.startsWith("public/");

  const filtered = blobs.filter((b) => {
    if (filter === "user") return isUserUpload(b);
    if (filter === "admin") return isAdminUpload(b);
    return true;
  });

  const userBlobs = blobs.filter(isUserUpload);
  const adminBlobs = blobs.filter(isAdminUpload);
  // Cloudflare R2 free tier: 10 GB stored. (Vercel Blob's free tier was 1 GB.)
  const quotaGB = 10;
  const usedPct = Math.min(100, (totalSize / (quotaGB * 1024 * 1024 * 1024)) * 100);

  if (loading) {
    return <p className="text-gray-400 animate-pulse py-8 text-center text-sm">Loading R2 bucket…</p>;
  }

  return (
    <>
      {/* Catalog blob cleanup */}
      <div className="rounded-xl border border-amber-800/60 bg-amber-900/20 p-4 mb-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-amber-300 mb-1">Catalog PDF Cleanup</p>
            <p className="text-xs text-gray-400 leading-relaxed">
              Deletes all per-user catalog PDF blobs and any globally cached catalog copies.
              Catalog books will be served via the authenticated proxy with 30-day CDN edge caching — zero blob storage needed.
            </p>
            {cleanResult && (
              <p className="text-xs text-green-400 mt-2 font-medium">
                ✓ Deleted {cleanResult.deletedDocumentRows} document rows, {cleanResult.clearedCatalogCaches} catalog caches.
                {cleanResult.estimatedFreedFormatted !== "0 B" && ` ~${cleanResult.estimatedFreedFormatted} freed (tracked files only).`}
              </p>
            )}
          </div>
          <button
            onClick={runCleanup}
            disabled={cleaning}
            className="shrink-0 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white transition"
          >
            {cleaning ? "Cleaning…" : "Run Cleanup"}
          </button>
        </div>
      </div>

      {/* R2 bucket usage */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 mb-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold">R2 bucket usage</h2>
          <button onClick={load} className="rounded-lg border border-gray-700 px-3 py-1 text-xs hover:bg-gray-800 transition">Refresh</button>
        </div>
        {bucketName && (
          <p className="text-xs text-gray-500 mb-3 font-mono">{bucketName}</p>
        )}
        <div className="h-3 rounded-full bg-gray-800 overflow-hidden mb-2">
          <div
            className={`h-full rounded-full transition-all ${usedPct > 90 ? "bg-red-500" : usedPct > 70 ? "bg-amber-500" : "bg-blue-500"}`}
            style={{ width: `${usedPct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-400">
          <span>{fmtSize(totalSize)} in bucket</span>
          <span>{quotaGB} GB free tier ({usedPct.toFixed(1)}%)</span>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="rounded-lg border border-gray-800 p-3 text-center">
            <p className="text-lg font-bold">{objectCount || blobs.length}</p>
            <p className="text-xs text-gray-500">Objects in bucket</p>
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
            const uploaderLabel = blob.uploader
              ? blob.uploader.name
                ? `${blob.uploader.name} <${blob.uploader.email}>`
                : blob.uploader.email
              : null;
            return (
              <div key={blob.url} className="rounded-xl border border-gray-800 bg-gray-900 p-4 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => openBlobPreview(blob)}
                    className="text-left text-sm font-medium truncate w-full max-w-full text-white hover:text-cyan-300 hover:underline underline-offset-2 cursor-pointer"
                    title={isPdfBlobPathname(blob.pathname) ? "View PDF" : "Open file in new tab"}
                  >
                    {name}
                  </button>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-500">
                    <span className={`px-1.5 py-0.5 rounded font-medium ${isUserUpload(blob) ? "bg-blue-900/50 text-blue-400" : "bg-green-900/50 text-green-400"}`}>
                      {isUserUpload(blob) ? "User" : "Catalog"}
                    </span>
                    {blob.backend && (
                      <span
                        className={`px-1.5 py-0.5 rounded font-medium uppercase tracking-wide text-[10px] ${
                          blob.backend === "r2"
                            ? "bg-orange-900/40 text-orange-300"
                            : "bg-gray-800 text-gray-400"
                        }`}
                        title={blob.backend === "r2" ? "Cloudflare R2" : "Vercel Blob"}
                      >
                        {blob.backend === "r2" ? "R2" : "VB"}
                      </span>
                    )}
                    <span className="font-mono">{fmtSize(blob.size)}</span>
                    <span>{new Date(blob.uploadedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="truncate max-w-[200px] text-gray-600" title={folder}>{folder}/</span>
                  </div>
                  {isUserUpload(blob) && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                      <span className="rounded bg-blue-950/50 px-1.5 py-0.5 font-medium text-blue-300">
                        Uploaded by {uploaderLabel ?? "unknown user"}
                      </span>
                      {blob.documentTitle && (
                        <span className="truncate max-w-[280px]" title={blob.documentTitle}>
                          Document: {blob.documentTitle}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openBlobPreview(blob)}
                    className="rounded-md border border-cyan-800 px-3 py-1 text-xs text-cyan-400 hover:bg-cyan-900/30 transition"
                    title={isPdfBlobPathname(blob.pathname) ? "Preview PDF" : "Open in new tab"}
                  >
                    View
                  </button>
                  <button
                    onClick={() => setConfirmDelete(blob)}
                    disabled={deleting === blob.url}
                    className="rounded-md border border-red-800 px-3 py-1 text-xs text-red-400 hover:bg-red-900/30 transition disabled:opacity-40"
                  >
                    {deleting === blob.url ? "…" : "Delete"}
                  </button>
                </div>
              </div>
            );
          })}
      </div>

      {/* PDF preview (blob URL is public; admin-only page) */}
      {previewBlob && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm p-3 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-3 shrink-0 max-w-6xl mx-auto w-full">
            <p className="text-sm font-medium text-white truncate pr-4" title={decodeURIComponent(previewBlob.pathname.split("/").pop() ?? previewBlob.pathname)}>
              {decodeURIComponent(previewBlob.pathname.split("/").pop() ?? previewBlob.pathname)}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href={blobPdfServeSrc(previewBlob)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-gray-600 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 transition"
              >
                Open in new tab
              </a>
              <button
                type="button"
                onClick={() => setPreviewBlob(null)}
                className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black hover:bg-gray-200 transition"
              >
                Close
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 max-w-6xl mx-auto w-full rounded-lg border border-gray-800 overflow-hidden bg-gray-950">
            <iframe
              title="PDF preview"
              src={blobPdfServeSrc(previewBlob)}
              className="w-full h-full min-h-[70vh] border-0"
            />
          </div>
          <p className="text-center text-[11px] text-gray-500 mt-2 shrink-0">Press Escape to close</p>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-700 p-6 shadow-2xl">
            <h2 className="text-base font-semibold mb-1">Delete this blob?</h2>
            <p className="text-sm text-gray-400 mb-1 truncate">{decodeURIComponent(confirmDelete.pathname)}</p>
            <p className="text-sm text-gray-500 mb-1">{fmtSize(confirmDelete.size)}</p>
            <p className="text-sm text-red-400 mb-5">This will permanently delete the file from object storage. Any sessions or documents referencing it will break.</p>
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
