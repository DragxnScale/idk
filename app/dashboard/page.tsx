"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

interface StatsData {
  isAdmin?: boolean;
  totalSessions: number;
  totalMinutes: number;
  averageMinutes: number;
  streak: number;
  weekDays: WeekDay[];
  recentSessions: RecentSession[];
  todayMinutes: number;
  todaySessions: number;
  dailyMinutesGoal: number | null;
  dailySessionsGoal: number | null;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/study/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

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

  if (!stats) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-gray-600 dark:text-gray-400">
            Sign in to view your dashboard.
          </p>
          <Link
            href="/auth/signin"
            className="inline-block rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-black"
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
              className="rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-black"
            >
              New session
            </Link>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-8">
          <StatCard label="Total Sessions" value={String(stats.totalSessions)} />
          <StatCard
            label="Total Time"
            value={
              stats.totalMinutes >= 60
                ? `${Math.floor(stats.totalMinutes / 60)}h ${stats.totalMinutes % 60}m`
                : `${stats.totalMinutes}m`
            }
          />
          <StatCard label="Avg / Session" value={`${stats.averageMinutes}m`} />
          <StatCard
            label="Streak"
            value={`${stats.streak} day${stats.streak !== 1 ? "s" : ""}`}
          />
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
                          ? "bg-black dark:bg-white"
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

        {/* Bottom nav */}
        <div className="mt-8 flex flex-wrap gap-4 text-sm">
          <Link href="/" className="underline underline-offset-4">
            Home
          </Link>
          <Link href="/study/session" className="underline underline-offset-4">
            New session
          </Link>
          <Link href="/study/history" className="underline underline-offset-4">
            History
          </Link>
        </div>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 text-center dark:border-gray-800 dark:bg-gray-900">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
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
          className={`h-full rounded-full transition-all duration-500 ${done ? "bg-green-500" : "bg-black dark:bg-white"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
