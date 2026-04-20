"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  matchMultipleChoice,
  MC_LETTERS,
  SPEED_MS_PER_CHAR,
  type VelocityQuestion,
  type VelocitySpeed,
} from "@/lib/velocity-match";

type Phase = "pregame" | "reading" | "answering" | "feedback" | "results";

export interface VelocityAttempt {
  topic: string;
  question: string;
  userAnswer?: string;
  correctAnswer: string;
  correct: boolean;
  reactionMs: number | null;
  type: "mc" | "sa";
}

export interface VelocityReview {
  growthAreas: { topic: string; tip: string }[];
  videoSuggestions: { title: string; searchQuery: string; reason: string }[];
}

export interface VelocityResultsPayload {
  accuracy: number;
  correctCount: number;
  total: number;
  avgReactionMs: number | null;
  fastestMs: number | null;
  slowestMs: number | null;
  review: VelocityReview | null;
}

interface Props {
  questions: VelocityQuestion[];
  velocityGameId: string;
  /** Existing completed results, when the game has already been played. */
  initialResults?: VelocityResultsPayload | null;
  onReplay: () => void;
}

const POST_READ_GRACE_MS = 4000;
/** Pause between lines in the typewriter script (e.g. between the question and the first option). */
const INTER_LINE_PAUSE_MS = 300;

/** Build the reveal script for a question: question line first, then one line per MC option. */
function buildScript(q: VelocityQuestion): string[] {
  if (q.type === "mc") {
    return [q.question, q.options[0], q.options[1], q.options[2], q.options[3]];
  }
  return [q.question];
}

export function VelocityGame({ questions, velocityGameId, initialResults, onReplay }: Props) {
  const [phase, setPhase] = useState<Phase>(initialResults ? "results" : "pregame");
  const [speed, setSpeed] = useState<VelocitySpeed>("medium");
  const [qIndex, setQIndex] = useState(0);
  /** 0 = question line; 1-4 = MC option lines. */
  const [lineIdx, setLineIdx] = useState(0);
  /** Characters rendered in the currently-revealing line. */
  const [charsShown, setCharsShown] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [attempts, setAttempts] = useState<VelocityAttempt[]>([]);
  const [results, setResults] = useState<VelocityResultsPayload | null>(initialResults ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [grading, setGrading] = useState(false);
  const [feedback, setFeedback] = useState<{
    correct: boolean;
    explanation?: string;
    correctAnswer: string;
    reason?: string;
  } | null>(null);

  const typewriterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const current = questions[qIndex];
  const total = questions.length;
  const script = useMemo(() => (current ? buildScript(current) : []), [current]);

  const clearTimers = useCallback(() => {
    if (typewriterRef.current) {
      clearInterval(typewriterRef.current);
      typewriterRef.current = null;
    }
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
  }, []);

  const finalizeAttempt = useCallback(
    (attempt: VelocityAttempt, extra?: { explanation?: string; reason?: string }) => {
      setAttempts((prev) => [...prev, attempt]);
      setFeedback({
        correct: attempt.correct,
        explanation: extra?.explanation,
        correctAnswer: attempt.correctAnswer,
        reason: extra?.reason,
      });
      setPhase("feedback");
    },
    []
  );

  const handleTimeout = useCallback(() => {
    if (!current) return;
    const correctAnswer =
      current.type === "mc" ? current.options[current.correctIndex] : current.answer;
    finalizeAttempt(
      {
        topic: current.topic,
        question: current.question,
        correctAnswer,
        correct: false,
        reactionMs: null,
        type: current.type,
      },
      { explanation: current.explanation }
    );
  }, [current, finalizeAttempt]);

  const handleBuzz = useCallback(() => {
    if (phase !== "reading") return;
    clearTimers();
    setPhase("answering");
    setTimeout(() => inputRef.current?.focus(), 10);
  }, [phase, clearTimers]);

  useEffect(() => {
    if (phase !== "reading" || !current || script.length === 0) return;

    setLineIdx(0);
    setCharsShown(0);
    setAnswerText("");
    const start = performance.now();
    setStartedAt(start);
    const msPerChar = SPEED_MS_PER_CHAR[speed];
    const gapTicks = Math.max(1, Math.ceil(INTER_LINE_PAUSE_MS / msPerChar));

    // Use closure-local counters to avoid stale React state inside the interval.
    let localLine = 0;
    let localChars = 0;
    let waitTicks = 0;

    typewriterRef.current = setInterval(() => {
      if (waitTicks > 0) {
        waitTicks--;
        return;
      }
      if (localLine >= script.length) return; // safety

      const line = script[localLine];
      localChars += 1;
      if (localChars > line.length) {
        // Finished this line.
        localLine += 1;
        localChars = 0;
        if (localLine >= script.length) {
          // Script complete — stop the typewriter and start the grace window.
          if (typewriterRef.current) {
            clearInterval(typewriterRef.current);
            typewriterRef.current = null;
          }
          setLineIdx(localLine);
          setCharsShown(0);
          graceTimerRef.current = setTimeout(() => {
            handleTimeout();
          }, POST_READ_GRACE_MS);
          return;
        }
        setLineIdx(localLine);
        setCharsShown(0);
        waitTicks = gapTicks;
        return;
      }
      setLineIdx(localLine);
      setCharsShown(localChars);
    }, msPerChar);

    return () => clearTimers();
  }, [phase, qIndex, current, script, speed, handleTimeout, clearTimers]);

  useEffect(() => {
    if (phase !== "reading") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        handleBuzz();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, handleBuzz]);

  const submitAnswer = useCallback(async () => {
    if (phase !== "answering" || !current || startedAt == null) return;
    const reactionMs = Math.max(0, Math.round(performance.now() - startedAt));

    if (current.type === "mc") {
      const { correct } = matchMultipleChoice(
        answerText,
        current.options,
        current.correctIndex
      );
      finalizeAttempt(
        {
          topic: current.topic,
          question: current.question,
          userAnswer: answerText,
          correctAnswer: current.options[current.correctIndex],
          correct,
          reactionMs,
          type: "mc",
        },
        { explanation: current.explanation }
      );
      return;
    }

    // Short answer — AI grader decides whether the response is close enough.
    setGrading(true);
    let correct = false;
    let reason: string | undefined;
    try {
      const res = await fetch("/api/ai/velocity/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: current.question,
          correctAnswer: current.answer,
          userAnswer: answerText,
          topic: current.topic,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { correct: boolean; reason: string };
        correct = !!data.correct;
        reason = data.reason;
      } else {
        reason = "Grader unavailable — response treated as incorrect.";
      }
    } catch {
      reason = "Could not reach the grader — response treated as incorrect.";
    } finally {
      setGrading(false);
    }

    finalizeAttempt(
      {
        topic: current.topic,
        question: current.question,
        userAnswer: answerText,
        correctAnswer: current.answer,
        correct,
        reactionMs,
        type: "sa",
      },
      { explanation: current.explanation, reason }
    );
  }, [phase, current, startedAt, answerText, finalizeAttempt]);

  const nextQuestion = useCallback(async () => {
    setFeedback(null);
    const nextIdx = qIndex + 1;
    if (nextIdx < total) {
      setQIndex(nextIdx);
      setPhase("reading");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/ai/velocity/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ velocityGameId, attempts }),
      });
      if (res.ok) {
        const data = (await res.json()) as VelocityResultsPayload;
        setResults(data);
      } else {
        const reactions = attempts
          .map((a) => a.reactionMs)
          .filter((n): n is number => typeof n === "number");
        const correctCount = attempts.filter((a) => a.correct).length;
        setResults({
          accuracy: Math.round((correctCount / attempts.length) * 100),
          correctCount,
          total: attempts.length,
          avgReactionMs: reactions.length
            ? Math.round(reactions.reduce((s, n) => s + n, 0) / reactions.length)
            : null,
          fastestMs: reactions.length ? Math.min(...reactions) : null,
          slowestMs: reactions.length ? Math.max(...reactions) : null,
          review: null,
        });
      }
    } catch {
      setResults({
        accuracy: 0,
        correctCount: 0,
        total: attempts.length,
        avgReactionMs: null,
        fastestMs: null,
        slowestMs: null,
        review: null,
      });
    } finally {
      setSubmitting(false);
      setPhase("results");
    }
  }, [attempts, qIndex, total, velocityGameId]);

  const startGame = useCallback(() => {
    setAttempts([]);
    setQIndex(0);
    setLineIdx(0);
    setCharsShown(0);
    setFeedback(null);
    setResults(null);
    setPhase("reading");
  }, []);

  /** Text shown for the question line (line 0). */
  const questionText = useMemo(() => {
    if (!current) return "";
    if (lineIdx > 0) return current.question;
    return current.question.slice(0, charsShown);
  }, [current, lineIdx, charsShown]);
  /** True once the question has finished (so MC options can start appearing). */
  const questionDone = lineIdx > 0 || phase !== "reading";

  if (phase === "pregame") return <Pregame speed={speed} setSpeed={setSpeed} onStart={startGame} total={total} />;

  if (phase === "results" && results) {
    return <Results results={results} onReplay={onReplay} />;
  }

  if (!current) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>
          Question <strong>{qIndex + 1}</strong> / {total}
        </span>
        <span className="uppercase tracking-wide">{current.type === "mc" ? "Multiple choice" : "Short answer"}</span>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 min-h-[180px] flex items-center dark:border-gray-800 dark:bg-gray-900">
        <p className="text-lg leading-relaxed font-medium">
          {questionText}
          {phase === "reading" && lineIdx === 0 && charsShown < current.question.length && (
            <span className="ml-0.5 inline-block w-[2px] h-5 bg-current align-middle animate-pulse" />
          )}
        </p>
      </div>

      {current.type === "mc" && questionDone && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {current.options.map((opt, i) => {
            const thisLine = i + 1;
            // Only show options the user actually heard. If they buzzed before
            // this option started revealing, keep it hidden — quiz-bowl rules:
            // you answer from what was read, not what would have been read.
            if (lineIdx < thisLine) return null;
            if (lineIdx === thisLine && charsShown === 0) return null;
            const isPartial = lineIdx === thisLine && charsShown < opt.length;
            const text = isPartial ? opt.slice(0, charsShown) : opt;
            const isRevealing = phase === "reading" && isPartial;
            return (
              <div
                key={i}
                className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-900"
              >
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 font-bold dark:bg-gray-800">
                  {MC_LETTERS[i]}
                </span>
                <span className="pt-1">
                  {text}
                  {isRevealing && (
                    <span className="ml-0.5 inline-block w-[2px] h-4 bg-current align-middle animate-pulse" />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {phase === "reading" && (
        <div className="flex flex-col items-center gap-3 pt-2">
          <button
            type="button"
            onClick={handleBuzz}
            className="h-28 w-28 rounded-full bg-red-500 text-white font-bold text-lg shadow-lg transition hover:bg-red-600 active:scale-95 ring-4 ring-red-300/50"
          >
            BUZZ
          </button>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Hit <kbd className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-mono dark:bg-gray-800">Space</kbd> or tap the buzzer to lock in your answer
          </p>
        </div>
      )}

      {phase === "answering" && (
        <div className="rounded-2xl border border-black bg-white p-4 dark:border-white dark:bg-gray-900">
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            {current.type === "mc" ? "Type the answer text or W / X / Y / Z" : "Type your answer"}
          </label>
          <input
            ref={inputRef}
            type="text"
            value={answerText}
            onChange={(e) => setAnswerText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !grading) {
                e.preventDefault();
                void submitAnswer();
              }
            }}
            disabled={grading}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base outline-none focus:border-black dark:border-gray-600 dark:bg-gray-950 dark:focus:border-white disabled:opacity-60"
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {grading ? "Checking your answer…" : current.type === "sa" ? "Graded by AI — close is close enough." : ""}
            </p>
            <button
              type="button"
              onClick={() => void submitAnswer()}
              disabled={grading}
              className="btn-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {grading ? "Checking…" : "Submit"}
            </button>
          </div>
        </div>
      )}

      {phase === "feedback" && feedback && (
        <div
          className={`rounded-2xl border p-5 ${
            feedback.correct
              ? "border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/20"
              : "border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/20"
          }`}
        >
          <p className="text-sm font-semibold">
            {feedback.correct ? "Correct!" : "Not quite."}
          </p>
          {!feedback.correct && (
            <p className="mt-1 text-sm">
              Correct answer: <strong>{feedback.correctAnswer}</strong>
            </p>
          )}
          {feedback.reason && (
            <p className="mt-2 text-xs italic text-gray-600 dark:text-gray-300">{feedback.reason}</p>
          )}
          {feedback.explanation && (
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">{feedback.explanation}</p>
          )}
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={nextQuestion}
              disabled={submitting}
              className="btn-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {qIndex + 1 >= total ? (submitting ? "Scoring…" : "See results") : "Next question"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Pregame({
  speed,
  setSpeed,
  onStart,
  total,
}: {
  speed: VelocitySpeed;
  setSpeed: (s: VelocitySpeed) => void;
  onStart: () => void;
  total: number;
}) {
  const options: { id: VelocitySpeed; label: string; desc: string }[] = [
    { id: "slow", label: "Slow", desc: "70ms / char — relaxed reading pace" },
    { id: "medium", label: "Medium", desc: "40ms / char — classic quizbowl feel" },
    { id: "fast", label: "Fast", desc: "20ms / char — reflex mode" },
  ];
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <h3 className="text-lg font-bold">Velocity</h3>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        A reaction-speed quiz on what you just read. Questions type out — buzz in with{" "}
        <kbd className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-mono dark:bg-gray-800">Space</kbd>{" "}
        the moment you know the answer.
      </p>

      <div className="mt-5 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Typewriter speed</p>
        {options.map((o) => (
          <label
            key={o.id}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
              speed === o.id
                ? "border-black bg-gray-50 dark:border-white dark:bg-gray-800"
                : "border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600"
            }`}
          >
            <input
              type="radio"
              name="speed"
              value={o.id}
              checked={speed === o.id}
              onChange={() => setSpeed(o.id)}
              className="mt-1"
            />
            <div>
              <p className="text-sm font-medium">{o.label}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{o.desc}</p>
            </div>
          </label>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-400">{total} questions</p>
        <button
          type="button"
          onClick={onStart}
          className="btn-primary rounded-lg px-5 py-2.5 text-sm font-medium"
        >
          Start Velocity
        </button>
      </div>
    </div>
  );
}

function Results({
  results,
  onReplay,
}: {
  results: VelocityResultsPayload;
  onReplay: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center dark:border-gray-800 dark:bg-gray-900">
        <p className="text-5xl font-bold">{results.accuracy}%</p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {results.correctCount} / {results.total} correct
        </p>
        <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
          <StatBox
            label="Avg reaction"
            value={results.avgReactionMs != null ? `${(results.avgReactionMs / 1000).toFixed(2)}s` : "—"}
          />
          <StatBox
            label="Fastest"
            value={results.fastestMs != null ? `${(results.fastestMs / 1000).toFixed(2)}s` : "—"}
          />
          <StatBox
            label="Slowest"
            value={results.slowestMs != null ? `${(results.slowestMs / 1000).toFixed(2)}s` : "—"}
          />
        </div>
      </div>

      {results.review?.growthAreas && results.review.growthAreas.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <h4 className="text-sm font-semibold mb-3">Growth areas</h4>
          <ul className="space-y-3">
            {results.review.growthAreas.map((g, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                <div>
                  <p className="text-sm font-medium">{g.topic}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-400">{g.tip}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {results.review?.videoSuggestions && results.review.videoSuggestions.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
          <h4 className="text-sm font-semibold mb-3">Recommended videos</h4>
          <div className="space-y-2">
            {results.review.videoSuggestions.map((v, i) => (
              <a
                key={i}
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(v.searchQuery)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 transition hover:border-red-400 hover:shadow-sm dark:border-gray-700 dark:hover:border-red-500 group"
              >
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-red-50 dark:bg-red-900/20">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-red-600" aria-hidden>
                    <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.8 15.5V8.5l6.3 3.5-6.3 3.5z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium group-hover:text-red-600 dark:group-hover:text-red-400 leading-snug">
                    {v.title}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{v.reason}</p>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">↗</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onReplay}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600"
        >
          Play again
        </button>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <p className="text-base font-bold">{value}</p>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}
