"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { Timer, type GoalType } from "@/components/study/Timer";
import { VisibilityGuard } from "@/components/focus/VisibilityGuard";
import { FullscreenTrigger } from "@/components/focus/FullscreenTrigger";
import { OverrideFlow } from "@/components/focus/OverrideFlow";
import dynamic from "next/dynamic";
import { DocumentPicker, type SelectedDocument } from "@/components/study/DocumentPicker";
import { AiNotesPanel } from "@/components/study/AiNotesPanel";

const PdfViewer = dynamic(
  () => import("@/components/study/PdfViewer").then((m) => m.PdfViewer),
  { ssr: false, loading: () => <p className="text-sm text-gray-500 animate-pulse">Loading reader…</p> }
);

export default function StudySessionPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [goalType, setGoalType] = useState<GoalType>("time");
  const [targetValue, setTargetValue] = useState(25);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<SelectedDocument | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [pageTexts, setPageTexts] = useState<Map<number, string>>(new Map());

  const focusedMinutesRef = useRef(0);
  const lastSavedRef = useRef(0);
  const accumulatedTextRef = useRef("");

  const handlePageText = useCallback((page: number, text: string) => {
    setPageTexts((prev) => {
      if (prev.has(page)) return prev;
      const next = new Map(prev);
      next.set(page, text);
      return next;
    });
    accumulatedTextRef.current += `\n\n[Page ${page}]\n${text}`;
  }, []);

  const handleStart = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/study/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalType, targetValue }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to start session");
      }
      const data = await res.json();
      setSessionId(data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }, [goalType, targetValue]);

  const saveProgress = useCallback(
    async (minutes: number) => {
      if (!sessionId || minutes <= lastSavedRef.current) return;
      lastSavedRef.current = minutes;
      try {
        await fetch("/api/study/sessions", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, totalFocusedMinutes: minutes }),
        });
      } catch {
        // will retry on next tick
      }
    },
    [sessionId]
  );

  const handleEnd = useCallback(async () => {
    if (!sessionId) return;

    // Store accumulated text in sessionStorage for the summary page
    if (accumulatedTextRef.current.trim()) {
      try {
        sessionStorage.setItem(`session-text-${sessionId}`, accumulatedTextRef.current);
      } catch {
        // storage may be full
      }
    }

    try {
      await fetch("/api/study/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          endedAt: new Date().toISOString(),
          totalFocusedMinutes: focusedMinutesRef.current,
        }),
      });
    } finally {
      window.location.href = `/study/session/${sessionId}/summary`;
    }
  }, [sessionId]);

  function getPdfUrl(): string | null {
    if (!selectedDoc) return null;
    if (selectedDoc.type === "upload") {
      return `/api/documents/${selectedDoc.documentId}/file`;
    }
    if (selectedDoc.type === "textbook" && selectedDoc.sourceUrl) {
      return `/api/proxy/pdf?url=${encodeURIComponent(selectedDoc.sourceUrl)}`;
    }
    return null;
  }

  /* ── Setup screen ──────────────────────────────────────────────── */
  if (!sessionId) {
    return (
      <main className="min-h-screen px-6 py-10 md:px-10 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Start a study session</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-8 leading-relaxed">
          Pick your reading material, set a goal, and start studying.
        </p>

        {/* Step 1: Document */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">1. Reading material</h2>
          {selectedDoc ? (
            <div className="flex items-center gap-3 rounded-lg border border-green-300 bg-green-50 p-3 dark:border-green-700 dark:bg-green-900/20">
              <span className="text-green-700 dark:text-green-400 text-sm font-medium flex-1">
                {selectedDoc.title}
              </span>
              <button
                type="button"
                onClick={() => setSelectedDoc(null)}
                className="text-xs underline text-gray-500"
              >
                Change
              </button>
            </div>
          ) : (
            <DocumentPicker onSelect={setSelectedDoc} />
          )}
        </section>

        {/* Step 2: Goal */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">2. Study goal</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!selectedDoc) {
                setError("Pick reading material first");
                return;
              }
              handleStart();
            }}
            className="space-y-5"
          >
            <div>
              <label className="block text-sm font-medium mb-1.5">Goal type</label>
              <select
                value={goalType}
                onChange={(e) => setGoalType(e.target.value as GoalType)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
              >
                <option value="time">Time (minutes)</option>
                <option value="chapter">Chapter</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                {goalType === "time" ? "Minutes" : "Chapter number"}
              </label>
              <input
                type="number"
                min={1}
                max={goalType === "time" ? 240 : 99}
                value={targetValue}
                onChange={(e) => setTargetValue(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={!selectedDoc}
              className="w-full rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
            >
              Start session
            </button>
          </form>
        </section>

        <Link href="/" className="inline-block text-sm underline underline-offset-4">
          Back to home
        </Link>
      </main>
    );
  }

  /* ── Active session ────────────────────────────────────────────── */
  const pdfUrl = getPdfUrl();

  return (
    <VisibilityGuard
      onTabReturn={() => setIsPaused(true)}
      onResume={() => setIsPaused(false)}
    >
      <main className="min-h-screen flex flex-col">
        {/* Top bar */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 px-6 py-3 dark:border-gray-700">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold">
              {selectedDoc?.title ?? "Study session"}
            </h1>
            {isPaused && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Paused
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowNotes((v) => !v)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                showNotes
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-300"
                  : "border-gray-300 dark:border-gray-600"
              }`}
            >
              {showNotes ? "Hide Notes" : "AI Notes"}
            </button>
            <FullscreenTrigger className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-600" />
            <OverrideFlow onConfirmEnd={handleEnd} />
          </div>
        </header>

        {/* Body */}
        <div className="flex flex-1 flex-col lg:flex-row">
          {/* Timer sidebar */}
          <aside className="flex-shrink-0 border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-700 p-6 lg:w-64">
            <Timer
              goalType={goalType}
              targetValue={targetValue}
              isPaused={isPaused}
              onTick={(mins) => {
                focusedMinutesRef.current = mins;
                saveProgress(mins);
              }}
              onGoalReached={handleEnd}
            />
            <div className="mt-4 text-xs text-gray-500 dark:text-gray-400 space-y-1">
              <p>Pages read: {pageTexts.size}</p>
              <p>Stay on this tab to keep the timer running.</p>
            </div>
          </aside>

          {/* Reader */}
          <section className="flex-1 overflow-auto p-6 flex justify-center">
            {pdfUrl ? (
              <PdfViewer
                url={pdfUrl}
                initialPage={selectedDoc?.startPage ?? 1}
                onPageText={handlePageText}
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-center max-w-md py-20">
                <p className="text-4xl mb-4">📖</p>
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  {selectedDoc
                    ? "This textbook doesn't have a viewable PDF source. Use the timer alongside your physical book or another tab."
                    : "No document selected. End the session and start a new one with reading material."}
                </p>
              </div>
            )}
          </section>

          {/* AI Notes panel */}
          {showNotes && (
            <aside className="w-full lg:w-80 flex-shrink-0 border-t lg:border-t-0 lg:border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
              <AiNotesPanel sessionId={sessionId} pageTexts={pageTexts} />
            </aside>
          )}
        </div>
      </main>
    </VisibilityGuard>
  );
}
