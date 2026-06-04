"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  formatInterval,
  Grade,
  previewAllGrades,
  SrsState,
  type GradeValue,
} from "@/lib/srs";

/**
 * Fullscreen spaced-repetition review session.
 *
 * Lifecycle:
 *
 *   1. On mount, fetch `/api/review/queue` and either render the first
 *      card or a "Nothing due" empty state.
 *   2. User reveals the back (Space / click) and grades 1..4 (number
 *      keys / on-screen buttons). Each grade fires a single
 *      `/api/review/grade` POST. The card moves to the next position
 *      in the local queue.
 *   3. When the local queue runs dry but the API said the queue size
 *      was bigger than `limit`, refetch and continue. When everything
 *      is cleared the end screen renders.
 *   4. On unmount (component removed because user navigated away or
 *      the queue cleared) we POST `/api/review/session` once with
 *      the wall-clock time spent and the number of cards reviewed.
 *      That row drives the daily streak; less than one card graded
 *      means no row is written.
 *
 * Keyboard:
 *
 *   - Space — flip the card (or grade Good when already flipped, the
 *     same shortcut as Anki for fast streaks).
 *   - 1 / 2 / 3 / 4 — grade Again / Hard / Good / Easy (only after
 *     the card has been revealed; pressing them on the front does
 *     nothing, prevents accidental "Again" presses).
 *   - Esc — exit (the persisted progress is automatic per-grade so
 *     there's nothing to save).
 *
 * Mobile: card flips on tap; grade buttons are fixed at the bottom
 * for thumb reachability. Number keys / Space have no equivalent so
 * the on-screen buttons are the only path on touch devices.
 */

interface QueueCard {
  id: string;
  front: string;
  back: string;
  pageNumber: number | null;
  srsState: number;
  stability: number;
  difficulty: number;
  dueAt: number | null;
  lastReviewedAt: number | null;
  lapses: number;
  reps: number;
  learningSteps: number;
  deckTitle: string;
}

interface QueueResponse {
  cards: QueueCard[];
  queueSize: number;
  newRemainingToday: number;
  reviewsRemainingToday: number;
  capReached?: boolean;
}

const QUEUE_LIMIT = 50;

const GRADE_LABELS: Record<GradeValue, string> = {
  [Grade.Again]: "Again",
  [Grade.Hard]: "Hard",
  [Grade.Good]: "Good",
  [Grade.Easy]: "Easy",
};

const GRADE_HINTS: Record<GradeValue, string> = {
  [Grade.Again]: "1",
  [Grade.Hard]: "2",
  [Grade.Good]: "3",
  [Grade.Easy]: "4",
};

const GRADE_COLORS: Record<GradeValue, string> = {
  // Anki-flavored palette: red / orange / green / blue. Keeping it
  // muted enough that the front/back card content stays the focus.
  [Grade.Again]: "bg-red-500 hover:bg-red-600 text-white",
  [Grade.Hard]: "bg-orange-500 hover:bg-orange-600 text-white",
  [Grade.Good]: "bg-emerald-500 hover:bg-emerald-600 text-white",
  [Grade.Easy]: "bg-blue-500 hover:bg-blue-600 text-white",
};

export function ReviewSession() {
  const [queue, setQueue] = useState<QueueCard[]>([]);
  const [stats, setStats] = useState<{
    queueSize: number;
    newRemainingToday: number;
    reviewsRemainingToday: number;
  } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [done, setDone] = useState(false);

  const sessionStartRef = useRef<number>(Date.now());
  const sessionPostedRef = useRef(false);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/review/queue?limit=${QUEUE_LIMIT}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`queue fetch failed: ${res.status}`);
      const data: QueueResponse = await res.json();
      setQueue(data.cards);
      setStats({
        queueSize: data.queueSize,
        newRemainingToday: data.newRemainingToday,
        reviewsRemainingToday: data.reviewsRemainingToday,
      });
      if (data.cards.length === 0) setDone(true);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Post the session record once when the user leaves (queue cleared
  // or navigated away). Guarded by `sessionPostedRef` so a re-render
  // doesn't fire a second POST.
  const recordSession = useCallback(async () => {
    if (sessionPostedRef.current) return;
    if (reviewedCount === 0) {
      sessionPostedRef.current = true;
      return;
    }
    sessionPostedRef.current = true;
    try {
      await fetch("/api/review/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startedAt: sessionStartRef.current,
          endedAt: Date.now(),
          cardsReviewed: reviewedCount,
        }),
      });
    } catch {
      // Streak credit is best-effort; the user is leaving anyway.
    }
  }, [reviewedCount]);

  useEffect(() => {
    const onUnload = () => {
      // sendBeacon fires reliably on tab close where async fetch may not.
      if (sessionPostedRef.current || reviewedCount === 0) return;
      sessionPostedRef.current = true;
      const body = JSON.stringify({
        startedAt: sessionStartRef.current,
        endedAt: Date.now(),
        cardsReviewed: reviewedCount,
      });
      try {
        navigator.sendBeacon?.(
          "/api/review/session",
          new Blob([body], { type: "application/json" })
        );
      } catch {}
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      void recordSession();
    };
  }, [recordSession, reviewedCount]);

  const current = queue[0] ?? null;

  const previews = useMemo(() => {
    if (!current) return null;
    return previewAllGrades({
      srsState: current.srsState,
      stability: current.stability,
      difficulty: current.difficulty,
      dueAt: current.dueAt ? new Date(current.dueAt) : null,
      lastReviewedAt: current.lastReviewedAt
        ? new Date(current.lastReviewedAt)
        : null,
      lapses: current.lapses,
      reps: current.reps,
      learningSteps: current.learningSteps,
    });
  }, [current]);

  const onGrade = useCallback(
    async (grade: GradeValue) => {
      if (!current || grading || !revealed) return;
      setGrading(true);
      try {
        const res = await fetch("/api/review/grade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId: current.id, grade }),
        });
        if (!res.ok) throw new Error(`grade failed: ${res.status}`);
        const data = await res.json();
        setReviewedCount((n) => n + 1);
        setRevealed(false);
        setQueue((prev) => {
          const [, ...rest] = prev;
          // Relearning cards (Again / Hard on Learning) come due in a
          // few minutes — push them back to the end of the local queue
          // so the user works through everything else first, but still
          // sees them again in the same session. The server schedule
          // is the source of truth — the next refetch may also return
          // them based on the lookahead window.
          if (
            data.card.srsState === SrsState.Learning ||
            data.card.srsState === SrsState.Relearning
          ) {
            return [
              ...rest,
              { ...current, ...data.card, deckTitle: current.deckTitle },
            ];
          }
          return rest;
        });
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      } finally {
        setGrading(false);
      }
    },
    [current, grading, revealed]
  );

  // Refill the queue when local queue is empty but server reported more.
  useEffect(() => {
    if (queue.length === 0 && !loading && !done && reviewedCount > 0) {
      // Could be the relearning cards finishing — try one refetch.
      loadQueue();
    }
  }, [queue.length, loading, done, reviewedCount, loadQueue]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " ") {
        e.preventDefault();
        if (!revealed) {
          setRevealed(true);
          return;
        }
        // Flipped + Space → grade Good (Anki convention).
        void onGrade(Grade.Good);
        return;
      }
      if (!revealed) return;
      if (e.key === "1") void onGrade(Grade.Again);
      if (e.key === "2") void onGrade(Grade.Hard);
      if (e.key === "3") void onGrade(Grade.Good);
      if (e.key === "4") void onGrade(Grade.Easy);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, onGrade]);

  // ── Render ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-gray-500">Loading queue…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold mb-2">Review unavailable</h1>
        <p className="text-sm text-red-500 mb-4">{error}</p>
        <button
          onClick={loadQueue}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  if (done || !current) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-2xl font-semibold mb-3">
          {reviewedCount === 0
            ? "Nothing due right now"
            : `Reviewed ${reviewedCount} card${reviewedCount === 1 ? "" : "s"} — nice work`}
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          {reviewedCount === 0
            ? "Come back tomorrow — your schedule is clear."
            : "Your next cards will surface as they come due."}
        </p>
        <Link
          href="/dashboard"
          className="inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  const totalForBar = (stats?.queueSize ?? 0) + reviewedCount;
  const progressPct = totalForBar > 0
    ? Math.min(100, (reviewedCount / totalForBar) * 100)
    : 0;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-900">
      <div className="border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
          >
            ← Exit
          </Link>
          <p className="text-xs text-gray-500">
            {reviewedCount} reviewed · {queue.length} remaining
          </p>
        </div>
        <div className="mx-auto mt-2 max-w-2xl">
          <div className="h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          <p className="mb-3 text-center text-xs text-gray-500">
            {current.deckTitle}
            {current.pageNumber != null && ` · p. ${current.pageNumber}`}
          </p>

          <div
            className="cursor-pointer rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-12"
            style={{ minHeight: "300px" }}
            onClick={() => setRevealed((r) => !r)}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {revealed ? "Answer" : "Front"}
            </p>
            <p className="mt-4 text-xl font-semibold leading-snug">
              {current.front}
            </p>
            {revealed && (
              <>
                <hr className="my-6 border-gray-200 dark:border-gray-700" />
                <p className="text-xs font-medium uppercase tracking-wide text-accent">
                  Back
                </p>
                <p className="mt-3 text-base leading-relaxed">
                  {current.back}
                </p>
              </>
            )}
            {!revealed && (
              <p className="mt-8 text-center text-xs text-gray-400">
                Tap or press <kbd className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] dark:bg-gray-700">Space</kbd> to reveal
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto max-w-2xl">
          {revealed ? (
            <div className="grid grid-cols-4 gap-2">
              {([Grade.Again, Grade.Hard, Grade.Good, Grade.Easy] as GradeValue[]).map(
                (g) => {
                  const preview = previews?.[g];
                  return (
                    <button
                      key={g}
                      disabled={grading}
                      onClick={() => onGrade(g)}
                      className={`flex flex-col items-center justify-center rounded-lg px-2 py-3 text-sm font-medium transition disabled:opacity-50 ${GRADE_COLORS[g]}`}
                    >
                      <span className="text-xs opacity-80">
                        {GRADE_HINTS[g]}
                      </span>
                      <span>{GRADE_LABELS[g]}</span>
                      {preview && (
                        <span className="text-[10px] opacity-80">
                          {formatInterval(preview.intervalDays)}
                        </span>
                      )}
                    </button>
                  );
                }
              )}
            </div>
          ) : (
            <button
              onClick={() => setRevealed(true)}
              className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-medium text-white"
            >
              Show answer (Space)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
