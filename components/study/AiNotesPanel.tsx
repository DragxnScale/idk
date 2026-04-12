"use client";

import { useCallback, useState } from "react";
import { aiNoteContentToHtml } from "@/lib/ai-notes-render";

interface NoteEntry {
  id: string;
  pageNumber: number;
  content: string;
}

interface AiNotesPanelProps {
  sessionId: string | null;
  pageTexts: Map<number, string>;
}

export function AiNotesPanel({ sessionId, pageTexts }: AiNotesPanelProps) {
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedPages, setGeneratedPages] = useState<Set<number>>(new Set());

  const generateNotesForPage = useCallback(
    async (pageNumber: number) => {
      if (!sessionId) return;
      const pageText = pageTexts.get(pageNumber);
      if (!pageText) return;
      if (generatedPages.has(pageNumber)) return;

      setGenerating(true);
      setError(null);

      try {
        const res = await fetch("/api/ai/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, pageNumber, pageText }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Failed to generate notes");
        }
        const note = (await res.json()) as NoteEntry;
        setNotes((prev) => [...prev, note]);
        setGeneratedPages((prev) => new Set(prev).add(pageNumber));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error generating notes");
      } finally {
        setGenerating(false);
      }
    },
    [sessionId, pageTexts, generatedPages]
  );

  const generateAllNew = useCallback(async () => {
    const pages = Array.from(pageTexts.keys())
      .filter((p) => !generatedPages.has(p))
      .sort((a, b) => a - b);

    for (const page of pages) {
      await generateNotesForPage(page);
    }
  }, [pageTexts, generatedPages, generateNotesForPage]);

  const newPagesAvailable = Array.from(pageTexts.keys()).filter(
    (p) => !generatedPages.has(p)
  ).length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <h2 className="text-sm font-semibold">AI Notes</h2>
        {newPagesAvailable > 0 && (
          <button
            onClick={generateAllNew}
            disabled={generating}
            className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? "Generating…" : `Generate (${newPagesAvailable} pages)`}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded p-2">
            {error}
          </p>
        )}

        {notes.length === 0 && !generating && (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {pageTexts.size === 0
                ? "Read some pages and AI will generate study notes."
                : "Click \"Generate\" to create notes from the pages you've read."}
            </p>
          </div>
        )}

        {generating && notes.length === 0 && (
          <p className="text-sm text-gray-500 animate-pulse text-center py-8">
            Generating notes…
          </p>
        )}

        {notes.map((note) => (
          <div
            key={note.id}
            className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
          >
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
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
    </div>
  );
}
