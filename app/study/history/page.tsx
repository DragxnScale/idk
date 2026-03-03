"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface StudySession {
  id: string;
  goalType: string;
  targetValue: number;
  startedAt: string | null;
  endedAt: string | null;
  totalFocusedMinutes: number | null;
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/study/sessions")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load sessions");
        return res.json();
      })
      .then(setSessions)
      .catch((e) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, []);

  const totalMinutes = sessions.reduce(
    (sum, s) => sum + (s.totalFocusedMinutes ?? 0),
    0
  );

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Study History</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {sessions.length} session{sessions.length !== 1 ? "s" : ""} &middot;{" "}
              {totalMinutes >= 60
                ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
                : `${totalMinutes}m`}{" "}
              total
            </p>
          </div>
          <Link
            href="/study/session"
            className="btn-primary rounded-lg px-4 py-2 text-sm font-medium"
          >
            New session
          </Link>
        </div>

        {loading && (
          <div className="flex justify-center py-16">
            <div className="spinner" />
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && sessions.length === 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-gray-900">
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              No sessions yet. Start your first study session!
            </p>
            <Link
              href="/study/session"
              className="btn-primary inline-block rounded-lg px-5 py-2.5 text-sm font-medium"
            >
              Start studying
            </Link>
          </div>
        )}

        {sessions.length > 0 && (
          <ul className="space-y-3">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/study/session/${s.id}/summary`}
                  className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 transition hover:border-gray-400 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-600"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {s.goalType === "time"
                        ? `${s.targetValue} min goal`
                        : `Chapter ${s.targetValue}`}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {s.startedAt
                        ? new Date(s.startedAt).toLocaleDateString(undefined, {
                            weekday: "short",
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
                    <p
                      className={`text-xs mt-0.5 ${
                        s.endedAt
                          ? "text-green-600 dark:text-green-400"
                          : "text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {s.endedAt ? "Completed" : "In progress"}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 flex flex-wrap gap-4 text-sm">
          <Link href="/dashboard" className="underline underline-offset-4">
            Dashboard
          </Link>
          <Link href="/" className="underline underline-offset-4">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
