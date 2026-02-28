"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { QuizView } from "@/components/study/QuizView";
import { ReviewPanel } from "@/components/study/ReviewPanel";

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface ReviewData {
  keyConcepts: string[];
  thingsToReview: string[];
  videoSuggestions: { title: string; searchQuery: string }[];
}

interface NoteEntry {
  id: string;
  pageNumber: number | null;
  content: string;
}

interface SessionInfo {
  goalType: string;
  targetValue: number;
  startedAt: string | null;
  endedAt: string | null;
  totalFocusedMinutes: number | null;
  lastPageIndex: number | null;
}

type Tab = "stats" | "notes" | "quiz" | "review";

export default function SessionSummaryPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [tab, setTab] = useState<Tab>("stats");
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!sessionId) return;

    fetch(`/api/study/sessions/${sessionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setSessionInfo(data));

    fetch(`/api/ai/notes?sessionId=${sessionId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setNotes);

    fetch(`/api/ai/quiz?sessionId=${sessionId}`)
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setQuestions(data.questions);
          setReview(data.review);
          if (data.score != null) setScore(data.score);
        }
      })
      .catch(() => {});
  }, [sessionId]);

  const generateQuiz = useCallback(async () => {
    setQuizLoading(true);
    setQuizError("");

    const storedText = sessionStorage.getItem(`session-text-${sessionId}`);
    if (!storedText || storedText.length < 50) {
      setQuizError("No reading text available. Read some PDF pages during your session for quiz generation.");
      setQuizLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/ai/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, accumulatedText: storedText }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to generate quiz");
      }
      const data = await res.json();
      setQuestions(data.questions);
      setReview(data.review);
      setTab("quiz");
    } catch (e) {
      setQuizError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setQuizLoading(false);
    }
  }, [sessionId]);

  const handleQuizComplete = useCallback(
    (finalScore: number) => {
      setScore(finalScore);
      setTab("review");
    },
    []
  );

  const copyNotes = useCallback(() => {
    const text = notes.map((n) => `Page ${n.pageNumber}:\n${n.content}`).join("\n\n---\n\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [notes]);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "stats", label: "Overview" },
    { key: "notes", label: "Notes", count: notes.length },
    { key: "quiz", label: "Quiz", count: questions.length },
    { key: "review", label: "Review" },
  ];

  const duration =
    sessionInfo?.startedAt && sessionInfo?.endedAt
      ? Math.round(
          (new Date(sessionInfo.endedAt).getTime() -
            new Date(sessionInfo.startedAt).getTime()) /
            60000
        )
      : null;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <h1 className="text-2xl font-bold">Session Summary</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {sessionInfo?.startedAt
              ? new Date(sessionInfo.startedAt).toLocaleDateString(undefined, {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })
              : `Session ${sessionId?.slice(0, 8)}…`}
          </p>
        </div>

        {/* Tabs */}
        <div className="mx-auto max-w-3xl px-6">
          <nav className="flex gap-1 -mb-px">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.key
                    ? "border-black text-black dark:border-white dark:text-white"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                {t.label}
                {t.count != null && t.count > 0 && (
                  <span className="ml-1.5 rounded-full bg-gray-200 px-1.5 py-0.5 text-xs dark:bg-gray-700">
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-3xl px-6 py-8">
        {/* ── Stats tab ──────────────────────────────────────────── */}
        {tab === "stats" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard
                label="Duration"
                value={duration != null ? `${duration}m` : "—"}
              />
              <StatCard
                label="Focused"
                value={
                  sessionInfo?.totalFocusedMinutes != null
                    ? `${sessionInfo.totalFocusedMinutes}m`
                    : "—"
                }
              />
              <StatCard
                label="Goal"
                value={
                  sessionInfo
                    ? sessionInfo.goalType === "time"
                      ? `${sessionInfo.targetValue}m`
                      : `Ch. ${sessionInfo.targetValue}`
                    : "—"
                }
              />
              <StatCard
                label="Quiz Score"
                value={
                  score != null && questions.length > 0
                    ? `${Math.round((score / questions.length) * 100)}%`
                    : "—"
                }
              />
            </div>

            {sessionInfo?.startedAt && sessionInfo?.endedAt && (
              <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                <h3 className="text-sm font-semibold mb-3">Session Timeline</h3>
                <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
                  <span>
                    Started{" "}
                    {new Date(sessionInfo.startedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="flex-1 border-t border-dashed border-gray-300 dark:border-gray-700" />
                  <span>
                    Ended{" "}
                    {new Date(sessionInfo.endedAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
            )}

            {questions.length === 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-6 text-center dark:border-gray-800 dark:bg-gray-900">
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  No quiz generated yet for this session.
                </p>
                <button
                  onClick={generateQuiz}
                  disabled={quizLoading}
                  className="rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
                >
                  {quizLoading ? "Generating…" : "Generate Quiz & Review"}
                </button>
                {quizError && (
                  <p className="mt-3 text-sm text-red-600 dark:text-red-400">{quizError}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Notes tab ──────────────────────────────────────────── */}
        {tab === "notes" && (
          <div className="space-y-4">
            {notes.length > 0 && (
              <div className="flex justify-end">
                <button
                  onClick={copyNotes}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium transition hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
                >
                  {copied ? "Copied!" : "Copy all notes"}
                </button>
              </div>
            )}

            {notes.length === 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
                <p className="text-gray-500 dark:text-gray-400">
                  No AI notes were generated during this session.
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  Use the &quot;AI Notes&quot; button during a session to generate notes as you read.
                </p>
              </div>
            )}

            {notes.map((note) => (
              <div
                key={note.id}
                className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900"
              >
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">
                  Page {note.pageNumber}
                </p>
                <div
                  className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{
                    __html: note.content
                      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                      .replace(/\n- /g, "<br/>• ")
                      .replace(/\n/g, "<br/>"),
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {/* ── Quiz tab ───────────────────────────────────────────── */}
        {tab === "quiz" && (
          <>
            {questions.length > 0 ? (
              score != null ? (
                <div className="rounded-xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
                  <p className="text-5xl font-bold mb-2">
                    {Math.round((score / questions.length) * 100)}%
                  </p>
                  <p className="text-gray-600 dark:text-gray-400">
                    You scored <strong>{score}</strong> out of{" "}
                    <strong>{questions.length}</strong>
                  </p>
                  <button
                    onClick={() => {
                      setScore(null);
                    }}
                    className="mt-4 text-sm underline underline-offset-4 text-gray-500"
                  >
                    Retake quiz
                  </button>
                </div>
              ) : (
                <QuizView questions={questions} onComplete={handleQuizComplete} />
              )
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
                <p className="text-gray-500 dark:text-gray-400 mb-4">
                  No quiz available yet.
                </p>
                <button
                  onClick={generateQuiz}
                  disabled={quizLoading}
                  className="rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
                >
                  {quizLoading ? "Generating…" : "Generate Quiz"}
                </button>
                {quizError && (
                  <p className="mt-3 text-sm text-red-600 dark:text-red-400">{quizError}</p>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Review tab ─────────────────────────────────────────── */}
        {tab === "review" && (
          <>
            {review ? (
              <ReviewPanel
                review={review}
                score={score ?? 0}
                totalQuestions={questions.length}
              />
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
                <p className="text-gray-500 dark:text-gray-400">
                  Complete the quiz first to see your review material.
                </p>
              </div>
            )}
          </>
        )}

        {/* Bottom nav */}
        <div className="mt-10 flex flex-wrap gap-4 text-sm border-t border-gray-200 pt-6 dark:border-gray-800">
          <Link
            href="/study/session"
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            New session
          </Link>
          <Link
            href="/study/history"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600"
          >
            History
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-center dark:border-gray-800 dark:bg-gray-900">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
    </div>
  );
}
