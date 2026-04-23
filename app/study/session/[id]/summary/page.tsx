"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { aiNoteContentToHtml, stripLatexForAiNotes } from "@/lib/ai-notes-render";
import { QuizView, type WrongAnswer } from "@/components/study/QuizView";
import { ReviewPanel } from "@/components/study/ReviewPanel";
import { FlashcardView, type Flashcard } from "@/components/study/FlashcardView";
import {
  VelocityGame,
  type VelocityResultsPayload,
} from "@/components/study/VelocityGame";
import type { VelocityQuestion } from "@/lib/velocity-match";

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface ReviewData {
  perfect?: boolean;
  thingsToReview: string[];
  videoSuggestions: { title: string; searchQuery: string }[];
}

interface VideoRec {
  title: string;
  searchQuery: string;
  reason: string;
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

type Tab = "stats" | "notes" | "quiz" | "review" | "flashcards" | "velocity";

export default function SessionSummaryPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [tab, setTab] = useState<Tab>("stats");
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [quizId, setQuizId] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState("");
  const [copied, setCopied] = useState(false);
  const [videos, setVideos] = useState<VideoRec[] | null>(null);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosError, setVideosError] = useState("");
  const [flashcardList, setFlashcardList] = useState<Flashcard[]>([]);
  const [flashcardsLoading, setFlashcardsLoading] = useState(false);
  const [flashcardsError, setFlashcardsError] = useState("");
  const [velocityId, setVelocityId] = useState<string | null>(null);
  const [velocityQuestions, setVelocityQuestions] = useState<VelocityQuestion[]>([]);
  const [velocityResults, setVelocityResults] = useState<VelocityResultsPayload | null>(null);
  const [velocityLoading, setVelocityLoading] = useState(false);
  const [velocityError, setVelocityError] = useState("");

  function handleExport() {
    const lines: string[] = [];
    lines.push(`# Session Summary\n`);
    if (sessionInfo) {
      const started = sessionInfo.startedAt ? new Date(sessionInfo.startedAt).toLocaleString() : "Unknown";
      lines.push(`**Date:** ${started}`);
      lines.push(`**Duration:** ${sessionInfo.totalFocusedMinutes ?? 0} minutes`);
      lines.push(`**Pages visited:** ${sessionInfo.lastPageIndex ?? 0}\n`);
    }
    if (notes.length > 0) {
      lines.push(`## AI Notes\n`);
      for (const note of notes) {
        lines.push(`### Page ${note.pageNumber ?? "?"}\n`);
        lines.push(stripLatexForAiNotes(note.content));
        lines.push("");
      }
    }
    if (flashcardList.length > 0) {
      lines.push(`## Flashcards\n`);
      for (const card of flashcardList) {
        lines.push(`**${card.front}**`);
        lines.push(`> ${card.back}`);
        lines.push("");
      }
    }
    if (questions.length > 0) {
      lines.push(`## Quiz (${score ?? "?"} / ${questions.length})\n`);
      questions.forEach((q, i) => {
        lines.push(`${i + 1}. ${q.question}`);
        q.options.forEach((opt, j) => {
          const letter = String.fromCharCode(65 + j);
          lines.push(`   ${letter}. ${opt}${j === q.correctIndex ? " ✓" : ""}`);
        });
        lines.push(`   *${q.explanation}*`);
        lines.push("");
      });
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-${sessionId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
          setQuizId(data.id);
          if (data.score != null) setScore(data.score);
        }
      })
      .catch(() => {});

    // Load cached videos first, then auto-generate if we have session text
    fetch(`/api/ai/videos?sessionId=${sessionId}`)      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.videos) {
          setVideos(data.videos);
        } else {
          // Auto-generate if session text is available
          const storedText = sessionStorage.getItem(`session-text-${sessionId}`);
          if (storedText && storedText.length >= 50) {
            generateVideos(storedText);
          }
        }
      })
      .catch(() => {});

    // Load cached flashcards
    fetch(`/api/ai/flashcards?sessionId=${sessionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.cards?.length) setFlashcardList(data.cards);
      })
      .catch(() => {});

    // Load cached Velocity minigame, if any
    fetch(`/api/ai/velocity?sessionId=${sessionId}`)
      .then(async (r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setVelocityId(data.id);
        setVelocityQuestions(data.questions ?? []);
        if (data.results) {
          setVelocityResults({
            accuracy: data.accuracy ?? data.results.accuracy ?? 0,
            correctCount: data.results.correctCount ?? 0,
            total: data.results.total ?? (data.questions?.length ?? 0),
            avgReactionMs: data.avgReactionMs ?? data.results.avgReactionMs ?? null,
            fastestMs: data.results.fastestMs ?? null,
            slowestMs: data.results.slowestMs ?? null,
            score: data.results.score ?? 0,
            negCount: data.results.negCount ?? 0,
            streakBest: data.results.streakBest ?? 0,
            bonusSeen: data.results.bonusSeen ?? 0,
            bonusCorrect: data.results.bonusCorrect ?? 0,
            bonusConversionRate: data.results.bonusConversionRate ?? 0,
            attempts: data.results.attempts ?? [],
            review: data.review ?? null,
          });
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const generateVelocity = useCallback(async () => {
    const storedText = sessionStorage.getItem(`session-text-${sessionId}`);
    if (!storedText || storedText.length < 50) {
      setVelocityError("No reading text available. Read some PDF pages during your session to unlock Velocity.");
      return;
    }
    setVelocityLoading(true);
    setVelocityError("");
    try {
      const res = await fetch("/api/ai/velocity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, accumulatedText: storedText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg =
          typeof data?.error === "string"
            ? data.error
            : `Failed to generate Velocity questions (HTTP ${res.status})`;
        void fetch("/api/debug/client-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `[velocity-client] ${errMsg}`,
            extra: {
              scope: "velocity-generate",
              sessionId,
              status: res.status,
              textLength: storedText.length,
            },
          }),
          keepalive: true,
        }).catch(() => {});
        throw new Error(errMsg);
      }
      setVelocityId(data.id);
      setVelocityQuestions(data.questions ?? []);
      setVelocityResults(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      setVelocityError(msg);
      if (!(e instanceof Error) || !msg.includes("HTTP")) {
        void fetch("/api/debug/client-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `[velocity-client] ${msg}`,
            stack: e instanceof Error ? e.stack : undefined,
            extra: { scope: "velocity-generate-exception", sessionId },
          }),
          keepalive: true,
        }).catch(() => {});
      }
    } finally {
      setVelocityLoading(false);
    }
  }, [sessionId]);

  /** Fetch a second batch of Velocity questions for the current game, append
   *  them to local state, and return ONLY the newly-added ones so the game
   *  component can resume at the seam. Throws on failure so the component
   *  can surface the error inline. */
  const continueVelocityBatch = useCallback(async (): Promise<VelocityQuestion[]> => {
    if (!velocityId) throw new Error("No Velocity game is active.");
    const storedText = sessionStorage.getItem(`session-text-${sessionId}`);
    if (!storedText || storedText.length < 50) {
      throw new Error("Reading text is unavailable — can't generate more questions.");
    }
    const res = await fetch("/api/ai/velocity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        accumulatedText: storedText,
        continueFromGameId: velocityId,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        typeof data?.error === "string"
          ? data.error
          : `Failed to load more Velocity questions (HTTP ${res.status})`;
      throw new Error(msg);
    }
    const allQuestions = (data.questions ?? []) as VelocityQuestion[];
    const added = allQuestions.slice(-(data.addedCount ?? 0));
    // Mirror the freshly-appended list back into local state so any future
    // re-mount sees the combined question pool.
    setVelocityQuestions(allQuestions);
    return added;
  }, [sessionId, velocityId]);

  const generateVideos = useCallback(async (text?: string) => {
    const storedText = text ?? sessionStorage.getItem(`session-text-${sessionId}`);
    if (!storedText || storedText.length < 50) {
      setVideosError("No reading text available — read some PDF pages during your session.");
      return;
    }
    setVideosLoading(true);
    setVideosError("");
    try {
      const res = await fetch("/api/ai/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, accumulatedText: storedText }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setVideos(data.videos);
      } else {
        setVideosError(data.error ?? "Failed to generate recommendations");
      }
    } catch {
      setVideosError("Network error. Please try again.");
    } finally {
      setVideosLoading(false);
    }
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
      setReview(data.review ?? null);
      setQuizId(data.id);
      setTab("quiz");
    } catch (e) {
      setQuizError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setQuizLoading(false);
    }
  }, [sessionId]);

  const handleQuizComplete = useCallback(
    async (finalScore: number, total: number, wrongAnswers: WrongAnswer[]) => {
      setScore(finalScore);
      setReviewLoading(true);
      setTab("review");
      try {
        const res = await fetch("/api/ai/quiz/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quizId,
            score: finalScore,
            totalQuestions: total,
            wrongQuestions: wrongAnswers,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setReview(data);
        }
      } catch {
        // review failed silently — UI will show a retry or empty state
      } finally {
        setReviewLoading(false);
      }
    },
    [quizId]
  );

  const copyNotes = useCallback(() => {
    const text = notes
      .map((n) => `Page ${n.pageNumber}:\n${stripLatexForAiNotes(n.content)}`)
      .join("\n\n---\n\n");
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
    { key: "flashcards", label: "Flashcards", count: flashcardList.length > 0 ? flashcardList.length : undefined },
    { key: "velocity", label: "Velocity", count: velocityQuestions.length > 0 ? velocityQuestions.length : undefined },
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
                  className="btn-primary rounded-lg px-5 py-2.5 text-sm font-medium disabled:opacity-50"
                >
                  {quizLoading ? "Generating…" : "Generate Quiz & Review"}
                </button>
                {quizError && (
                  <p className="mt-3 text-sm text-red-600 dark:text-red-400">{quizError}</p>
                )}
              </div>
            )}

            {/* ── YouTube recommendations ─────────────────────────── */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold">Recommended Videos</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    AI-picked YouTube searches based on what you read
                  </p>
                </div>
                {!videosLoading && (
                  <button
                    onClick={() => generateVideos()}
                    className="text-xs text-gray-500 underline underline-offset-4 hover:text-black dark:hover:text-white"
                  >
                    {videos ? "Refresh" : "Generate"}
                  </button>
                )}
              </div>

              {videosLoading && (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="animate-pulse flex gap-3 rounded-lg border border-gray-100 p-3 dark:border-gray-800">
                      <div className="h-10 w-10 rounded bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
                      <div className="flex-1 space-y-2 py-1">
                        <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 w-3/4" />
                        <div className="h-2.5 rounded bg-gray-100 dark:bg-gray-800 w-full" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!videosLoading && videos && videos.length > 0 && (
                <div className="space-y-2">
                  {videos.map((v, i) => (
                    <a
                      key={i}
                      href={`https://www.youtube.com/results?search_query=${encodeURIComponent(v.searchQuery)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 transition hover:border-red-400 hover:shadow-sm dark:border-gray-700 dark:hover:border-red-500 group"
                    >
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-red-50 dark:bg-red-900/20">
                        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-red-600" aria-hidden>
                          <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.8 15.5V8.5l6.3 3.5-6.3 3.5z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium group-hover:text-red-600 dark:group-hover:text-red-400 leading-snug">
                          {v.title}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                          {v.reason}
                        </p>
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">↗</span>
                    </a>
                  ))}
                </div>
              )}

              {!videosLoading && !videos && (
                <p className="text-sm text-gray-400 text-center py-4">
                  {videosError || "Generating recommendations…"}
                </p>
              )}

              {!videosLoading && videosError && (
                <p className="text-xs text-red-500 mt-2">{videosError}</p>
              )}
            </div>
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
                    __html: aiNoteContentToHtml(note.content),
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
                  className="btn-primary rounded-lg px-5 py-2.5 text-sm font-medium disabled:opacity-50"
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
            {reviewLoading ? (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900 space-y-3">
                <div className="h-8 w-8 rounded-full border-2 border-gray-300 border-t-black animate-spin mx-auto dark:border-gray-600 dark:border-t-white" />
                <p className="text-sm text-gray-500">Generating your personalised review…</p>
              </div>
            ) : review ? (
              <ReviewPanel
                review={review}
                score={score ?? 0}
                totalQuestions={questions.length}
              />
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
                <p className="text-gray-500 dark:text-gray-400">
                  Complete the quiz first to see your personalised review.
                </p>
              </div>
            )}
          </>
        )}

        {/* ── Flashcards tab ──────────────────────────────────────── */}
        {tab === "flashcards" && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
            {flashcardList.length > 0 ? (
              <FlashcardView cards={flashcardList} />
            ) : (
              <div className="text-center py-6 space-y-4">
                <p className="text-gray-500 dark:text-gray-400 text-sm">
                  No flashcards yet. Generate them from your AI notes.
                </p>
                {flashcardsError && (
                  <p className="text-xs text-red-500">{flashcardsError}</p>
                )}
                <button
                  disabled={flashcardsLoading}
                  onClick={async () => {
                    setFlashcardsLoading(true);
                    setFlashcardsError("");
                    try {
                      const res = await fetch("/api/ai/flashcards", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ sessionId }),
                      });
                      const data = await res.json().catch(() => ({}));
                      if (res.ok) {
                        setFlashcardList(data.cards ?? []);
                      } else {
                        setFlashcardsError(data.error ?? "Failed to generate flashcards");
                      }
                    } catch {
                      setFlashcardsError("Network error. Please try again.");
                    } finally {
                      setFlashcardsLoading(false);
                    }
                  }}
                  className="btn-primary rounded-lg px-6 py-2.5 text-sm font-medium disabled:opacity-60"
                >
                  {flashcardsLoading ? "Generating…" : "Generate Flashcards"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Velocity tab ────────────────────────────────────────── */}
        {tab === "velocity" && (
          <>
            {velocityQuestions.length > 0 && velocityId ? (
              <VelocityGame
                key={velocityId + (velocityResults ? ":done" : ":fresh")}
                velocityGameId={velocityId}
                questions={velocityQuestions}
                initialResults={velocityResults}
                onReplay={() => {
                  setVelocityResults(null);
                }}
                onContinueBatch={continueVelocityBatch}
              />
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
                <h3 className="text-lg font-bold">Velocity</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                  A rapid-fire reaction quiz on what you just read. Questions type out at your chosen speed — buzz in with{" "}
                  <kbd className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-mono dark:bg-gray-800">Space</kbd>{" "}
                  the moment you know the answer.
                </p>
                <button
                  onClick={generateVelocity}
                  disabled={velocityLoading}
                  className="btn-primary mt-5 rounded-lg px-5 py-2.5 text-sm font-medium disabled:opacity-50"
                >
                  {velocityLoading ? "Generating…" : "Generate Velocity"}
                </button>
                {velocityError && (
                  <p className="mt-3 text-sm text-red-600 dark:text-red-400">{velocityError}</p>
                )}
              </div>
            )}
          </>
        )}

        {/* Bottom nav */}
        <div className="mt-10 flex flex-wrap gap-4 text-sm border-t border-gray-200 pt-6 dark:border-gray-800">
          <Link
            href="/study/session"
            className="btn-primary rounded-lg px-4 py-2 text-sm font-medium"
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
          <button
            type="button"
            onClick={handleExport}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Export as Markdown
          </button>
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
