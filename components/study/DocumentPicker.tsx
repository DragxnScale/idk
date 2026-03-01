"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface TextbookEntry {
  id: string;
  title: string;
  edition: string | null;
  isbn: string | null;
  sourceType: "oer" | "user_upload";
  sourceUrl: string | null;
  chapters: string[];
  chapterPageRanges: Record<string, [number, number]>;
}

export interface SelectedDocument {
  type: "upload" | "textbook";
  documentId: string;
  title: string;
  startPage?: number;
  sourceUrl?: string;
  availableChapters?: string[];
  chapterPageRanges?: Record<string, [number, number]>;
}

interface DocumentPickerProps {
  onSelect: (doc: SelectedDocument) => void;
}

export function DocumentPicker({ onSelect }: DocumentPickerProps) {
  const [mode, setMode] = useState<"choose" | "upload" | "textbook">("choose");

  return (
    <div className="space-y-4">
      {mode === "choose" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Choose your reading material
          </p>
          <button
            type="button"
            onClick={() => setMode("upload")}
            className="flex items-center gap-3 rounded-lg border border-gray-300 p-4 text-left transition hover:border-black hover:shadow-sm dark:border-gray-600 dark:hover:border-white"
          >
            <span className="text-2xl">📄</span>
            <div>
              <p className="text-sm font-medium">Upload a PDF</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Upload your own textbook, notes, or reading material
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setMode("textbook")}
            className="flex items-center gap-3 rounded-lg border border-gray-300 p-4 text-left transition hover:border-black hover:shadow-sm dark:border-gray-600 dark:hover:border-white"
          >
            <span className="text-2xl">📚</span>
            <div>
              <p className="text-sm font-medium">Find a textbook</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Search our catalog of open-access and common textbooks
              </p>
            </div>
          </button>
        </div>
      )}

      {mode === "upload" && <UploadPanel onSelect={onSelect} onBack={() => setMode("choose")} />}
      {mode === "textbook" && <TextbookPanel onSelect={onSelect} onBack={() => setMode("choose")} />}
    </div>
  );
}

/* ── Upload Panel ──────────────────────────────────────────────────── */

function UploadPanel({
  onSelect,
  onBack,
}: {
  onSelect: (doc: SelectedDocument) => void;
  onBack: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    const form = new FormData();
    form.append("file", file);
    form.append("title", file.name.replace(/\.pdf$/i, ""));

    try {
      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Upload failed");
      }
      const data = await res.json();
      onSelect({
        type: "upload",
        documentId: data.id,
        title: data.title,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [onSelect]);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm underline underline-offset-4">
        ← Back
      </button>
      <div className="rounded-lg border-2 border-dashed border-gray-300 p-6 text-center dark:border-gray-600">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          onChange={handleUpload}
          disabled={uploading}
          className="block mx-auto text-sm"
        />
        {uploading && <p className="mt-3 text-sm text-gray-500 animate-pulse">Uploading…</p>}
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}

/* ── Textbook Panel ────────────────────────────────────────────────── */

function TextbookPanel({
  onSelect,
  onBack,
}: {
  onSelect: (doc: SelectedDocument) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TextbookEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedBook, setSelectedBook] = useState<TextbookEntry | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);
  const [customStart, setCustomStart] = useState<number | null>(null);
  const [customEnd, setCustomEnd] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/textbooks?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          setResults(await res.json());
        }
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  if (selectedBook) {
    const needsUpload = selectedBook.sourceType === "user_upload";
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => {
            setSelectedBook(null);
            setSelectedChapter(null);
          }}
          className="text-sm underline underline-offset-4"
        >
          ← Back to results
        </button>
        <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <h3 className="font-medium">
            {selectedBook.title}{" "}
            {selectedBook.edition && (
              <span className="text-gray-500">({selectedBook.edition} ed.)</span>
            )}
          </h3>
          {selectedBook.isbn && (
            <p className="text-xs text-gray-500 mt-0.5">ISBN: {selectedBook.isbn}</p>
          )}

          {needsUpload ? (
            <div className="mt-4 rounded bg-amber-50 p-3 text-sm dark:bg-amber-900/20">
              <p className="font-medium text-amber-800 dark:text-amber-300">
                This is a commercial textbook
              </p>
              <p className="mt-1 text-amber-700 dark:text-amber-400">
                You need to upload your own legal copy. Go back and use &quot;Upload a PDF&quot;.
              </p>
            </div>
          ) : (
            <>
              <p className="mt-3 text-sm font-medium">Select a chapter:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedBook.chapters.map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => { setSelectedChapter(ch); setCustomStart(null); setCustomEnd(null); }}
                    className={`rounded-md border px-3 py-1.5 text-sm transition ${
                      selectedChapter === ch
                        ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                        : "border-gray-300 hover:border-gray-400 dark:border-gray-600"
                    }`}
                  >
                    Ch. {ch}
                  </button>
                ))}
              </div>
              {selectedChapter && (() => {
                const range = selectedBook.chapterPageRanges[selectedChapter];
                const chStart = range ? range[0] : 1;
                const chEnd = range ? range[1] : 1;
                const startPage = customStart ?? chStart;
                const endPage = customEnd ?? chEnd;

                return (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                        Page range (Ch. {selectedChapter}: p. {chStart}–{chEnd})
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={chStart}
                          max={endPage}
                          value={startPage}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setCustomStart(v >= chStart && v <= chEnd ? v : chStart);
                          }}
                          className="w-20 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-center dark:border-gray-600 dark:bg-gray-800"
                        />
                        <span className="text-xs text-gray-400">to</span>
                        <input
                          type="number"
                          min={startPage}
                          max={chEnd}
                          value={endPage}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setCustomEnd(v >= chStart && v <= chEnd ? v : chEnd);
                          }}
                          className="w-20 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-center dark:border-gray-600 dark:bg-gray-800"
                        />
                        {(customStart !== null || customEnd !== null) && (
                          <button
                            type="button"
                            onClick={() => { setCustomStart(null); setCustomEnd(null); }}
                            className="text-xs text-gray-500 underline underline-offset-2"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        onSelect({
                          type: "textbook",
                          documentId: selectedBook.id,
                          title: `${selectedBook.title} — Ch. ${selectedChapter} (p. ${startPage}–${endPage})`,
                          startPage,
                          sourceUrl: selectedBook.sourceUrl ?? undefined,
                          availableChapters: selectedBook.chapters,
                          chapterPageRanges: selectedBook.chapterPageRanges,
                        });
                      }}
                      className="w-full rounded-lg bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
                    >
                      Read p. {startPage}–{endPage}
                    </button>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm underline underline-offset-4">
        ← Back
      </button>
      <input
        type="text"
        placeholder="Search textbooks (e.g. Chemistry, Biology)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
      />
      {loading && <p className="text-sm text-gray-500 animate-pulse">Searching…</p>}
      {!loading && results.length === 0 && (
        <p className="text-sm text-gray-500">No textbooks found. Try a different search term.</p>
      )}
      <ul className="space-y-2">
        {results.map((book) => (
          <li key={book.id}>
            <button
              type="button"
              onClick={() => setSelectedBook(book)}
              className="w-full rounded-lg border border-gray-200 p-3 text-left transition hover:border-gray-400 hover:shadow-sm dark:border-gray-700 dark:hover:border-gray-500"
            >
              <p className="text-sm font-medium">
                {book.title}{" "}
                {book.edition && (
                  <span className="text-gray-500">({book.edition} ed.)</span>
                )}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {book.sourceType === "oer" ? "Open Access" : "Requires your PDF"} · {book.chapters.length}{" "}
                chapters
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
