"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

const PageViewerModal = dynamic(() => import("./PageViewerModal"), { ssr: false });

interface WeekDay {
  date: string;
  minutes: number;
  sessions: number;
}

interface RecentSession {
  id: string;
  goalType: string;
  targetValue: number;
  startedAt: string | null;
  endedAt: string | null;
  totalFocusedMinutes: number | null;
}

interface ActiveSession {
  id: string;
  goalType: string;
  targetValue: number;
  startedAt: string | null;
  totalFocusedMinutes: number;
  lastPageIndex: number | null;
  documentJson: string | null;
}

interface BookmarkItem {
  id: string;
  documentId: string;
  sessionId: string | null;
  pageNumber: number;
  type: string;
  label: string | null;
  highlightText: string | null;
  color: string | null;
  tag: string | null;
  createdAt: string | null;
  sessionDate: string | null;
  docTitle: string | null;
  pdfUrl: string | null;
}

interface PlannerItem {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  label: string | null;
}

interface CountdownItem {
  id: string;
  title: string;
  examDate: string;
  totalPages: number | null;
  pagesCompleted: number;
}

interface StatsData {
  isAdmin?: boolean;
  totalSessions: number;
  totalMinutes: number;
  totalPages: number;
  averageMinutes: number;
  pagesPerHour: number;
  todayPages: number;
  streak: number;
  weekDays: WeekDay[];
  recentSessions: RecentSession[];
  todayMinutes: number;
  todaySessions: number;
  dailyMinutesGoal: number | null;
  dailySessionsGoal: number | null;
  inactivityTimeout: number | null;
  activeSession: ActiveSession | null;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [abandoning, setAbandoning] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [savedItems, setSavedItems] = useState<BookmarkItem[]>([]);
  const [viewingItem, setViewingItem] = useState<BookmarkItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  // Planner & countdowns
  const [plannerItems, setPlannerItems] = useState<PlannerItem[]>([]);
  const [countdowns, setCountdowns] = useState<CountdownItem[]>([]);
  const [showAddPlan, setShowAddPlan] = useState(false);
  const [showAddCountdown, setShowAddCountdown] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [msgText, setMsgText] = useState("");
  const [msgSending, setMsgSending] = useState(false);
  const [msgSent, setMsgSent] = useState(false);
  const [unreadMsgCount, setUnreadMsgCount] = useState(0);

  useEffect(() => {
    fetch("/api/study/stats")
      .then(async (r) => {
        if (r.ok) return r.json();
        if (r.status === 401) return null;
        const body = await r.text().catch(() => "");
        setFetchError(`Server error (${r.status}): ${body.slice(0, 300)}`);
        return null;
      })
      .then(setStats)
      .catch((e) => setFetchError(`Fetch failed: ${e}`))
      .finally(() => setLoading(false));

    fetch("/api/bookmarks/all")
      .then((r) => (r.ok ? r.json() : []))
      .then(setSavedItems)
      .catch(() => {});

    fetch("/api/messages")
      .then((r) => (r.ok ? r.json() : []))
      .then((msgs: { read?: boolean; toUserId?: string; fromUserId?: string }[]) => {
        if (Array.isArray(msgs)) {
          const unread = msgs.filter((m) => !m.read && m.fromUserId !== undefined).length;
          setUnreadMsgCount(unread);
        }
      })
      .catch(() => {});

    fetch("/api/planner")
      .then((r) => (r.ok ? r.json() : []))
      .then(setPlannerItems)
      .catch(() => {});

    fetch("/api/countdowns")
      .then((r) => (r.ok ? r.json() : []))
      .then(setCountdowns)
      .catch(() => {});
  }, []);

  async function deleteBookmark(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/bookmarks?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setSavedItems((prev) => prev.filter((b) => b.id !== id));
        if (viewingItem?.id === id) setViewingItem(null);
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function abandonSession(sessionId: string) {
    setAbandoning(true);
    await fetch("/api/study/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, endedAt: new Date().toISOString(), totalFocusedMinutes: stats?.activeSession?.totalFocusedMinutes ?? 0 }),
    });
    setStats((prev) => prev ? { ...prev, activeSession: null } : prev);
    setAbandoning(false);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 mx-auto rounded-full border-2 border-gray-300 border-t-black animate-spin dark:border-gray-600 dark:border-t-white" />
          <p className="text-sm text-gray-500">Loading dashboard…</p>
        </div>
      </main>
    );
  }

  if (fetchError) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-6">
        <div className="text-center space-y-4 max-w-md">
          <p className="text-red-600 dark:text-red-400 font-medium">Something went wrong</p>
          <pre className="text-xs text-left bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap break-all">
            {fetchError}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="btn-primary inline-block rounded-lg px-5 py-2.5 text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!stats) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-gray-600 dark:text-gray-400">
            Sign in to view your dashboard.
          </p>
          <Link
            href="/auth/signin"
            className="btn-primary inline-block rounded-lg px-5 py-2.5 text-sm font-medium"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  
  }

  const maxMinutes = Math.max(...stats.weekDays.map((d) => d.minutes), 1);

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto max-w-4xl px-6 py-10">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Your study progress at a glance
            </p>
          </div>
          <div className="flex items-center gap-2">
            {stats.isAdmin && (
              <Link
                href="/admin"
                className="rounded-lg border border-red-700 bg-red-900/20 px-4 py-2.5 text-sm font-medium text-red-400 hover:bg-red-900/40 transition"
              >
                Developer Mode
              </Link>
            )}
            <Link
              href="/settings"
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium dark:border-gray-600"
            >
              Settings
            </Link>
            <Link
              href="/study/session"
              className="btn-primary rounded-lg px-5 py-2.5 text-sm font-medium"
            >
              New session
            </Link>
          </div>
        </div>

        {/* Active session banner */}
        {stats.activeSession && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 mb-8 dark:border-amber-700 dark:bg-amber-900/20">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  You have an unfinished session
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  {stats.activeSession.goalType === "time"
                    ? `${stats.activeSession.targetValue} min goal`
                    : `${stats.activeSession.targetValue} chapter${stats.activeSession.targetValue !== 1 ? "s" : ""}`}
                  {" · "}
                  {stats.activeSession.totalFocusedMinutes}m studied
                  {stats.activeSession.startedAt && (
                    <> · Started {new Date(stats.activeSession.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/study/session?resume=${stats.activeSession.id}`}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition"
                >
                  Resume
                </Link>
                <button
                  onClick={() => abandonSession(stats.activeSession!.id)}
                  disabled={abandoning}
                  className="rounded-lg border border-amber-400 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-400 dark:hover:bg-amber-900/30 transition disabled:opacity-50"
                >
                  {abandoning ? "Ending…" : "End it"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Today's stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6 mb-8">
          <StatCard
            label="Today"
            value={
              stats.todayMinutes >= 60
                ? `${Math.floor(stats.todayMinutes / 60)}h ${stats.todayMinutes % 60}m`
                : `${stats.todayMinutes}m`
            }
          />
          <StatCard label="Sessions" value={String(stats.todaySessions)} />
          <StatCard label="Avg / Session" value={`${stats.averageMinutes}m`} />
          <StatCard
            label="Streak"
            value={`${stats.streak} day${stats.streak !== 1 ? "s" : ""}`}
          />
          <StatCard label="Pages Today" value={String(stats.todayPages)} />
          <StatCard label="Reading Speed" value={stats.pagesPerHour > 0 ? `${stats.pagesPerHour} pg/hr` : "—"} />
        </div>

        {/* Daily goal progress */}
        {(stats.dailyMinutesGoal || stats.dailySessionsGoal) && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 mb-8 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold">Today&apos;s Goals</h2>
              <Link
                href="/settings"
                className="text-xs text-gray-500 underline underline-offset-4 dark:text-gray-400"
              >
                Edit
              </Link>
            </div>
            <div className="space-y-4">
              {stats.dailyMinutesGoal != null && (
                <GoalBar
                  label="Study time"
                  current={stats.todayMinutes}
                  goal={stats.dailyMinutesGoal}
                  format={(v) => `${v}m`}
                />
              )}
              {stats.dailySessionsGoal != null && (
                <GoalBar
                  label="Sessions"
                  current={stats.todaySessions}
                  goal={stats.dailySessionsGoal}
                  format={(v) => String(v)}
                />
              )}
            </div>
          </div>
        )}

        {/* Weekly chart */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 mb-8 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-sm font-semibold mb-4">This Week</h2>
          <div className="flex items-end gap-2 h-32">
            {stats.weekDays.map((day) => {
              const height = maxMinutes > 0 ? (day.minutes / maxMinutes) * 100 : 0;
              const dayLabel = new Date(day.date + "T12:00:00").toLocaleDateString(
                undefined,
                { weekday: "short" }
              );
              const isToday =
                day.date === new Date().toISOString().slice(0, 10);
              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {day.minutes > 0 ? `${day.minutes}m` : ""}
                  </span>
                  <div className="w-full flex justify-center">
                    <div
                      className={`w-full max-w-[2rem] rounded-t-md transition-all ${
                        isToday
                          ? "bg-accent"
                          : "bg-gray-300 dark:bg-gray-700"
                      }`}
                      style={{ height: `${Math.max(height, 4)}%` }}
                    />
                  </div>
                  <span
                    className={`text-xs ${
                      isToday
                        ? "font-bold text-black dark:text-white"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {dayLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent sessions */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Recent Sessions</h2>
            <Link
              href="/study/history"
              className="text-xs text-gray-500 underline underline-offset-4 dark:text-gray-400"
            >
              View all
            </Link>
          </div>

          {stats.recentSessions.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
              No sessions yet. Start your first study session!
            </p>
          ) : (
            <ul className="space-y-2">
              {stats.recentSessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/study/session/${s.id}/summary`}
                    className="flex items-center justify-between rounded-lg border border-gray-100 p-3 transition hover:border-gray-300 hover:shadow-sm dark:border-gray-800 dark:hover:border-gray-600"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {s.goalType === "time"
                          ? `${s.targetValue} min goal`
                          : `Chapter ${s.targetValue}`}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {s.startedAt
                          ? new Date(s.startedAt).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "Unknown date"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">
                        {s.totalFocusedMinutes ?? 0}m
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {s.endedAt ? "Completed" : "In progress"}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Exam Countdowns */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 mt-8 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Exam Countdowns</h2>
            <button onClick={() => setShowAddCountdown(true)} className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">+ Add</button>
          </div>
          {countdowns.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-3">No exams added yet. Add one to see daily page targets.</p>
          ) : (
            <div className="space-y-3">
              {countdowns.map((cd) => {
                const daysLeft = Math.max(0, Math.ceil((new Date(cd.examDate).getTime() - Date.now()) / 86400000));
                const pagesLeft = (cd.totalPages ?? 0) - (cd.pagesCompleted ?? 0);
                const dailyTarget = daysLeft > 0 && pagesLeft > 0 ? Math.ceil(pagesLeft / daysLeft) : 0;
                return (
                  <div key={cd.id} className="group flex items-center justify-between rounded-lg border border-gray-100 p-3 dark:border-gray-800">
                    <div>
                      <p className="text-sm font-medium">{cd.title}</p>
                      <div className="flex gap-3 text-xs text-gray-500 mt-0.5">
                        <span className={daysLeft <= 7 ? "text-red-500 font-semibold" : ""}>{daysLeft} day{daysLeft !== 1 ? "s" : ""} left</span>
                        <span>{new Date(cd.examDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                        {cd.totalPages && <span>{cd.pagesCompleted}/{cd.totalPages} pages</span>}
                        {dailyTarget > 0 && <span className="font-medium">{dailyTarget} pg/day needed</span>}
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        await fetch(`/api/countdowns?id=${cd.id}`, { method: "DELETE" });
                        setCountdowns((prev) => prev.filter((c) => c.id !== cd.id));
                      }}
                      className="sm:opacity-0 sm:group-hover:opacity-100 text-xs text-gray-400 hover:text-red-500 transition"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Study Planner */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 mt-8 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">Weekly Study Planner</h2>
            <button onClick={() => setShowAddPlan(true)} className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">+ Add block</button>
          </div>
          {plannerItems.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-3">No study blocks scheduled. Plan your week!</p>
          ) : (
            <div className="grid grid-cols-7 gap-1.5">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => {
                const dayItems = plannerItems.filter((p) => p.dayOfWeek === i);
                const isToday = new Date().getDay() === i;
                return (
                  <div key={day} className={`rounded-lg border p-2 min-h-[80px] ${isToday ? "border-blue-300 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-900/10" : "border-gray-100 dark:border-gray-800"}`}>
                    <p className={`text-[10px] font-semibold mb-1 ${isToday ? "text-blue-600 dark:text-blue-400" : "text-gray-400"}`}>{day}</p>
                    {dayItems.map((item) => (
                      <div key={item.id} className="group relative rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-1 mb-1 text-[10px]">
                        <p className="font-medium truncate">{item.startTime}–{item.endTime}</p>
                        {item.label && <p className="text-gray-500 truncate">{item.label}</p>}
                        <button
                          onClick={async () => {
                            await fetch(`/api/planner?id=${item.id}`, { method: "DELETE" });
                            setPlannerItems((prev) => prev.filter((p) => p.id !== item.id));
                          }}
                          className="absolute top-0.5 right-0.5 sm:opacity-0 sm:group-hover:opacity-100 text-gray-400 hover:text-red-500 text-[10px]"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Add Plan Modal */}
        {showAddPlan && (
          <AddPlanModal
            onClose={() => setShowAddPlan(false)}
            onAdd={(item) => { setPlannerItems((prev) => [...prev, item]); setShowAddPlan(false); }}
          />
        )}

        {/* Add Countdown Modal */}
        {showAddCountdown && (
          <AddCountdownModal
            onClose={() => setShowAddCountdown(false)}
            onAdd={(item) => { setCountdowns((prev) => [...prev, item]); setShowAddCountdown(false); }}
          />
        )}

        {/* Saved Pages */}
        {savedItems.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 mt-8 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-sm font-semibold">Saved Pages &amp; Highlights</h2>
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => setTagFilter(null)}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] border transition ${!tagFilter ? "btn-primary border-black dark:border-white" : "border-gray-300 dark:border-gray-600"}`}
                >
                  All
                </button>
                {[{ id: "definition", label: "Definitions" }, { id: "key_concept", label: "Key Concepts" }, { id: "review", label: "Review" }, { id: "important", label: "Important" }].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTagFilter(tagFilter === t.id ? null : t.id)}
                    className={`rounded-full px-2.5 py-0.5 text-[10px] border transition ${tagFilter === t.id ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-300" : "border-gray-300 dark:border-gray-600"}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <ul className="space-y-2 max-h-80 overflow-auto">
              {savedItems.filter((item) => !tagFilter || item.tag === tagFilter).slice(0, 50).map((item) => (
                <li
                  key={item.id}
                  className="group flex items-start gap-3 rounded-lg border border-gray-100 p-3 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-600 transition"
                >
                  <button
                    onClick={() => item.pdfUrl ? setViewingItem(item) : undefined}
                    className={`flex items-start gap-3 flex-1 min-w-0 text-left ${item.pdfUrl ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <span className="mt-0.5 text-sm flex-shrink-0">
                      {item.type === "bookmark" ? "★" : "🖍"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {item.type === "bookmark"
                          ? `Page ${item.pageNumber}`
                          : `"${item.highlightText?.slice(0, 80)}${(item.highlightText?.length ?? 0) > 80 ? "…" : ""}"`}
                      </p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {item.docTitle ?? `Document ${item.documentId}`}
                          {item.sessionDate && (
                            <> · {new Date(item.sessionDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</>
                          )}
                        </p>
                        {item.tag && (
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-700">
                            {item.tag === "definition" ? "Definition" : item.tag === "key_concept" ? "Key Concept" : item.tag === "review" ? "Review" : item.tag === "important" ? "Important" : item.tag}
                          </span>
                        )}
                      </div>
                      {item.pdfUrl && (
                        <p className="text-[10px] text-blue-500 dark:text-blue-400 mt-0.5">Click to view page</p>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {item.color && (
                      <span
                        className={`w-3 h-3 rounded-full ${
                          item.color === "yellow" ? "bg-yellow-400" :
                          item.color === "green" ? "bg-emerald-400" :
                          item.color === "blue" ? "bg-blue-400" : "bg-pink-400"
                        }`}
                      />
                    )}
                    <button
                      onClick={() => deleteBookmark(item.id)}
                      disabled={deletingId === item.id}
                      className="sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 rounded p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                      title={item.type === "bookmark" ? "Remove bookmark" : "Remove highlight"}
                    >
                      {deletingId === item.id ? (
                        <span className="block h-3.5 w-3.5 rounded-full border border-gray-400 border-t-transparent animate-spin" />
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                          <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Page Viewer Modal */}
        {viewingItem && <PageViewerModal item={viewingItem} onClose={() => setViewingItem(null)} onDelete={deleteBookmark} />}

        {/* Bottom nav */}
        <div className="mt-8 flex flex-wrap items-center gap-4 text-sm">
          <Link href="/" className="underline underline-offset-4">
            Home
          </Link>
          <Link href="/study/session" className="underline underline-offset-4">
            New session
          </Link>
          <Link href="/study/history" className="underline underline-offset-4">
            History
          </Link>
          <button
            onClick={() => { setShowMessageModal(true); setMsgSent(false); }}
            className="ml-auto rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800 transition relative"
          >
            Message Developer
            {unreadMsgCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                {unreadMsgCount}
              </span>
            )}
          </button>
        </div>

        {/* Message modal */}
        {showMessageModal && (
          <MessageModal
            onClose={() => setShowMessageModal(false)}
            msgText={msgText}
            setMsgText={setMsgText}
            msgSending={msgSending}
            msgSent={msgSent}
            onSend={async () => {
              if (!msgText.trim() || msgSending) return;
              setMsgSending(true);
              try {
                const res = await fetch("/api/messages", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ content: msgText }),
                });
                if (res.ok) {
                  setMsgSent(true);
                  setMsgText("");
                } else {
                  const data = await res.json().catch(() => ({}));
                  alert(data.error ?? "Failed to send");
                }
              } finally {
                setMsgSending(false);
              }
            }}
          />
        )}
      </div>
    </main>
  );
}

function AddPlanModal({ onClose, onAdd }: { onClose: () => void; onAdd: (item: PlannerItem) => void }) {
  const [day, setDay] = useState(new Date().getDay());
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayOfWeek: day, startTime: start, endTime: end, label: label || null }),
      });
      if (res.ok) {
        const item = await res.json();
        onAdd(item);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4 rounded-2xl bg-white border border-gray-200 p-6 shadow-2xl dark:bg-gray-900 dark:border-gray-700">
        <h3 className="text-base font-semibold mb-4">Add study block</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Day</label>
            <select value={day} onChange={(e) => setDay(Number(e.target.value))} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800">
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
                <option key={i} value={i}>{d}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Start</label>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">End</label>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Label (optional)</label>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Biology Ch 5-6" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800" />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800 transition">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">{saving ? "Adding…" : "Add"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AddCountdownModal({ onClose, onAdd }: { onClose: () => void; onAdd: (item: CountdownItem) => void }) {
  const [title, setTitle] = useState("");
  const [examDate, setExamDate] = useState("");
  const [totalPages, setTotalPages] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title || !examDate) return;
    setSaving(true);
    try {
      const res = await fetch("/api/countdowns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, examDate, totalPages: totalPages ? Number(totalPages) : null }),
      });
      if (res.ok) {
        const item = await res.json();
        onAdd(item);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4 rounded-2xl bg-white border border-gray-200 p-6 shadow-2xl dark:bg-gray-900 dark:border-gray-700">
        <h3 className="text-base font-semibold mb-4">Add exam countdown</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Exam name</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Biology Final" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Exam date</label>
            <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} required className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Total pages to read (optional)</label>
            <input type="number" min={1} value={totalPages} onChange={(e) => setTotalPages(e.target.value)} placeholder="e.g. 450" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800" />
            <p className="text-[10px] text-gray-400 mt-1">If set, we&apos;ll calculate how many pages per day you need to read.</p>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800 transition">Cancel</button>
            <button type="submit" disabled={saving || !title || !examDate} className="btn-primary flex-1 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">{saving ? "Adding…" : "Add"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 text-center dark:border-gray-800 dark:bg-gray-900 card-themed transition">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
    </div>
  );
}

function MessageModal({
  onClose,
  msgText,
  setMsgText,
  msgSending,
  msgSent,
  onSend,
}: {
  onClose: () => void;
  msgText: string;
  setMsgText: (v: string) => void;
  msgSending: boolean;
  msgSent: boolean;
  onSend: () => void;
}) {
  const [history, setHistory] = useState<{ id: string; fromUserId: string; content: string; createdAt: string | null }[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const chatEndRef = useCallback((node: HTMLDivElement | null) => {
    node?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    fetch("/api/messages")
      .then((r) => (r.ok ? r.json() : { messages: [], currentUserId: null }))
      .then((data: { messages?: { id: string; fromUserId: string; content: string; createdAt: string | null }[]; currentUserId?: string }) => {
        if (data.messages) setHistory(data.messages);
        if (data.currentUserId) setMyUserId(data.currentUserId);
      })
      .catch(() => {});
  }, [msgSent]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white border border-gray-200 shadow-2xl dark:bg-gray-900 dark:border-gray-700 flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-5 py-3">
          <h3 className="font-semibold text-sm">Message Developer</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-3 min-h-[200px]">
          {history.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-8">No messages yet. Send one below!</p>
          )}
          {history.map((msg) => {
            const isMe = myUserId ? msg.fromUserId === myUserId : false;
            return (
              <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                    isMe
                      ? "btn-primary"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                  }`}
                >
                  {!isMe && (
                    <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-0.5">Developer</p>
                  )}
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  {msg.createdAt && (
                    <p className={`text-[10px] mt-1 ${isMe ? "text-gray-300 dark:text-gray-600" : "text-gray-400"}`}>
                      {new Date(msg.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={chatEndRef} />
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-3">
          {msgSent ? (
            <p className="text-sm text-green-600 dark:text-green-400 text-center py-2">Message sent!</p>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onSend()}
                placeholder="Type a message…"
                maxLength={2000}
                className="flex-1 rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-600"
              />
              <button
                onClick={onSend}
                disabled={msgSending || !msgText.trim()}
                className="btn-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40"
              >
                {msgSending ? "…" : "Send"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GoalBar({
  label,
  current,
  goal,
  format,
}: {
  label: string;
  current: number;
  goal: number;
  format: (v: number) => string;
}) {
  const pct = Math.min(100, goal > 0 ? Math.round((current / goal) * 100) : 0);
  const done = current >= goal;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</span>
        <span className={`text-xs font-semibold ${done ? "text-green-600 dark:text-green-400" : "text-gray-700 dark:text-gray-300"}`}>
          {format(current)} / {format(goal)}
          {done && " ✓"}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${done ? "bg-green-500" : "bg-accent"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
