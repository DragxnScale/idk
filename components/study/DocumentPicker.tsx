"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type OutlineItem = { title: string; dest: string | unknown[] | null; items: OutlineItem[] };

async function resolvePageIndex(
  doc: pdfjs.PDFDocumentProxy,
  dest: string | unknown[] | null
): Promise<number | null> {
  try {
    if (typeof dest === "string") {
      const resolved = await doc.getDestination(dest);
      if (resolved) return await doc.getPageIndex(resolved[0] as never);
    } else if (Array.isArray(dest) && dest[0]) {
      return await doc.getPageIndex(dest[0] as never);
    }
  } catch {}
  return null;
}

async function extractChapterRanges(
  proxyUrl: string
): Promise<Record<string, [number, number]> | null> {
  try {
    const doc = await pdfjs.getDocument(proxyUrl).promise;
    const outline: OutlineItem[] | null = await doc.getOutline();
    if (!outline || outline.length === 0) { await doc.destroy(); return null; }

    const chapters: { num: string; page: number }[] = [];

    for (const item of outline) {
      const match = item.title.match(/^(?:chapter\s+)?(\d{1,2})\s+[A-Za-z]/i);
      if (!match) continue;

      let pageIndex = await resolvePageIndex(doc, item.dest);

      // Fallback: use the first resolvable child item's destination
      if (pageIndex === null && item.items?.length) {
        for (const child of item.items) {
          const childIdx = await resolvePageIndex(doc, child.dest);
          if (childIdx !== null) {
            pageIndex = Math.max(0, childIdx - 1);
            break;
          }
        }
      }

      if (pageIndex === null) continue;

      chapters.push({ num: match[1], page: pageIndex + 1 });
    }

    const totalPages = doc.numPages;
    await doc.destroy();
    if (chapters.length === 0) return null;
    const ranges: Record<string, [number, number]> = {};
    for (let i = 0; i < chapters.length; i++) {
      const start = chapters[i].page;
      const end = i + 1 < chapters.length ? chapters[i + 1].page - 1 : totalPages;
      ranges[chapters[i].num] = [start, end];
    }

    return ranges;
  } catch (e) {
    console.warn("Failed to extract PDF outline:", e);
    return null;
  }
}

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
  const [mode, setMode] = useState<"choose" | "upload" | "textbook" | "drive">("choose");

  return (
    <div className="space-y-4">
      {mode === "choose" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Choose your reading material
          </p>
          <button
            type="button"
            onClick={() => setMode("drive")}
            className="flex items-center gap-3 rounded-lg border border-gray-300 p-4 text-left transition hover:border-black hover:shadow-sm dark:border-gray-600 dark:hover:border-white"
          >
            <span className="text-2xl">🗂️</span>
            <div>
              <p className="text-sm font-medium">My Drive</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Open a previously uploaded PDF or import from a link
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setMode("upload")}
            className="flex items-center gap-3 rounded-lg border border-gray-300 p-4 text-left transition hover:border-black hover:shadow-sm dark:border-gray-600 dark:hover:border-white"
          >
            <span className="text-2xl">📄</span>
            <div>
              <p className="text-sm font-medium">Upload a PDF</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Upload files or a folder from your computer
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

      {mode === "drive" && <DrivePanel onSelect={onSelect} onBack={() => setMode("choose")} />}
      {mode === "upload" && <UploadPanel onSelect={onSelect} onBack={() => setMode("choose")} />}
      {mode === "textbook" && <TextbookPanel onSelect={onSelect} onBack={() => setMode("choose")} />}
    </div>
  );
}

/* ── Drive Panel ───────────────────────────────────────────────────── */

interface DriveDoc {
  id: string;
  title: string;
  fileUrl: string;
  totalPages: number | null;
  createdAt: string | null;
}

function DrivePanel({
  onSelect,
  onBack,
}: {
  onSelect: (doc: SelectedDocument) => void;
  onBack: () => void;
}) {
  const [docs, setDocs] = useState<DriveDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  // URL import state
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/user/drive");
    if (res.ok) setDocs(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  async function handleImport() {
    if (!importUrl.trim()) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch("/api/user/drive/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: importUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error ?? "Import failed");
      } else {
        setImportUrl("");
        await loadDocs();
      }
    } catch {
      setImportError("Network error. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete(doc: DriveDoc) {
    setDeleting(doc.id);
    await fetch(`/api/user/drive?id=${doc.id}`, { method: "DELETE" });
    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    setDeleting(null);
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm underline underline-offset-4">
        ← Back
      </button>

      {/* URL Import */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2 dark:border-gray-700 dark:bg-gray-800/50">
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          Import from link
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500">
          Paste a direct URL to a PDF or ZIP file — ZIP files are automatically unpacked
        </p>
        <div className="flex gap-2">
          <input
            type="url"
            value={importUrl}
            onChange={(e) => { setImportUrl(e.target.value); setImportError(null); }}
            onKeyDown={(e) => e.key === "Enter" && handleImport()}
            placeholder="https://example.com/textbook.pdf"
            className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:border-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <button
            type="button"
            onClick={handleImport}
            disabled={importing || !importUrl.trim()}
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {importing ? "Importing…" : "Import"}
          </button>
        </div>
        {importError && (
          <p className="text-xs text-red-500">{importError}</p>
        )}
      </div>

      {/* Drive file list */}
      {loading ? (
        <p className="text-sm text-gray-400 animate-pulse">Loading your drive…</p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">
          No files saved yet. Upload PDFs or import from a link above.
        </p>
      ) : (
        <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {docs.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5 dark:border-gray-700"
            >
              <button
                type="button"
                onClick={() => onSelect({ type: "upload", documentId: doc.id, title: doc.title, sourceUrl: doc.fileUrl })}
                className="flex-1 text-left text-sm font-medium truncate hover:text-gray-600 dark:hover:text-gray-300 transition"
              >
                {doc.title}
              </button>
              <span className="text-xs text-gray-400 shrink-0">
                {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(doc)}
                disabled={deleting === doc.id}
                className="shrink-0 text-xs text-red-400 hover:text-red-600 disabled:opacity-40 px-1"
                title="Delete"
              >
                {deleting === doc.id ? "…" : "✕"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Upload Panel ──────────────────────────────────────────────────── */

type FileStatus = "pending" | "uploading" | "done" | "error";
interface FileItem {
  file: File;
  status: FileStatus;
  error?: string;
  result?: { id: string; title: string };
}

function UploadPanel({
  onSelect,
  onBack,
}: {
  onSelect: (doc: SelectedDocument) => void;
  onBack: () => void;
}) {
  const [items, setItems] = useState<FileItem[]>([]);
  const [running, setRunning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  // Attach webkitdirectory (not a standard React prop) via ref
  useEffect(() => {
    if (folderRef.current) {
      folderRef.current.setAttribute("webkitdirectory", "");
    }
  }, []);

  function addFiles(fileList: FileList) {
    const pdfs = Array.from(fileList).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (pdfs.length === 0) return;
    setItems((prev) => [
      ...prev,
      ...pdfs.map((file) => ({ file, status: "pending" as FileStatus })),
    ]);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }

  async function uploadAll() {
    setRunning(true);
    for (let i = 0; i < items.length; i++) {
      if (items[i].status !== "pending") continue;
      setItems((prev) =>
        prev.map((it, idx) => (idx === i ? { ...it, status: "uploading" } : it))
      );
      const form = new FormData();
      form.append("file", items[i].file);
      form.append("title", items[i].file.name.replace(/\.pdf$/i, ""));
      try {
        const res = await fetch("/api/documents/upload", { method: "POST", body: form });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Upload failed");
        }
        const data = await res.json();
        setItems((prev) =>
          prev.map((it, idx) =>
            idx === i ? { ...it, status: "done", result: { id: data.id, title: data.title } } : it
          )
        );
      } catch (e) {
        setItems((prev) =>
          prev.map((it, idx) =>
            idx === i
              ? { ...it, status: "error", error: e instanceof Error ? e.message : "Failed" }
              : it
          )
        );
      }
    }
    setRunning(false);
  }

  const uploaded = items.filter((it) => it.status === "done");
  const pending = items.filter((it) => it.status === "pending");
  const hasItems = items.length > 0;
  const allDone = hasItems && pending.length === 0 && !running;

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm underline underline-offset-4">
        ← Back
      </button>

      {/* Drop zone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="rounded-lg border-2 border-dashed border-gray-300 p-6 text-center dark:border-gray-600"
      >
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          Drop PDFs here, or:
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
          >
            Select files
          </button>
          <button
            type="button"
            onClick={() => folderRef.current?.click()}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
          >
            Select folder
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
        {/* folder input — webkitdirectory applied via ref */}
        <input
          ref={folderRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
      </div>

      {/* File list */}
      {hasItems && (
        <ul className="space-y-1.5 max-h-56 overflow-y-auto">
          {items.map((it, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm dark:border-gray-800"
            >
              <span className="flex-1 truncate text-gray-700 dark:text-gray-300">
                {it.file.name.replace(/\.pdf$/i, "")}
              </span>
              {it.status === "pending" && (
                <span className="text-xs text-gray-400">Pending</span>
              )}
              {it.status === "uploading" && (
                <span className="text-xs text-blue-500 animate-pulse">Uploading…</span>
              )}
              {it.status === "done" && (
                <span className="text-xs text-green-600 dark:text-green-400">✓ Done</span>
              )}
              {it.status === "error" && (
                <span className="text-xs text-red-500" title={it.error}>✗ Failed</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Upload button */}
      {pending.length > 0 && !running && (
        <button
          type="button"
          onClick={uploadAll}
          className="w-full rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-black"
        >
          Upload {pending.length} PDF{pending.length !== 1 ? "s" : ""}
        </button>
      )}

      {running && (
        <p className="text-center text-sm text-gray-500 animate-pulse">
          Uploading {items.filter((it) => it.status === "uploading").length > 0
            ? `"${items.find((it) => it.status === "uploading")?.file.name.replace(/\.pdf$/i, "")}"`
            : "…"}
        </p>
      )}

      {/* Pick one to study */}
      {allDone && uploaded.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">
            {uploaded.length === 1
              ? "Ready — start studying?"
              : `${uploaded.length} files uploaded — pick one to study:`}
          </p>
          <ul className="space-y-1.5">
            {uploaded.map((it, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() =>
                    onSelect({
                      type: "upload",
                      documentId: it.result!.id,
                      title: it.result!.title,
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-left text-sm font-medium transition hover:border-black hover:shadow-sm dark:border-gray-600 dark:hover:border-white"
                >
                  {it.result!.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
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
  const [extractedRanges, setExtractedRanges] = useState<Record<string, [number, number]> | null>(null);
  const [extracting, setExtracting] = useState(false);

  useEffect(() => {
    if (!selectedBook?.sourceUrl || selectedBook.sourceType === "user_upload") return;
    let cancelled = false;
    setExtracting(true);
    setExtractedRanges(null);

    const proxyUrl = `/api/proxy/pdf?url=${encodeURIComponent(selectedBook.sourceUrl)}`;
    extractChapterRanges(proxyUrl).then((ranges) => {
      if (!cancelled) {
        setExtractedRanges(ranges);
        setExtracting(false);
      }
    });

    return () => { cancelled = true; };
  }, [selectedBook?.id, selectedBook?.sourceUrl, selectedBook?.sourceType]);

  const activeRanges = extractedRanges ?? selectedBook?.chapterPageRanges ?? {};
  const activeChapters = extractedRanges
    ? Object.keys(extractedRanges).sort((a, b) => Number(a) - Number(b))
    : selectedBook?.chapters ?? [];

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
            setExtractedRanges(null);
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
              <p className="mt-3 text-sm font-medium">
                Select a chapter:
                {extracting && <span className="ml-2 text-xs text-gray-400 animate-pulse">Reading TOC…</span>}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {activeChapters.map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    disabled={extracting}
                    onClick={() => { setSelectedChapter(ch); setCustomStart(null); setCustomEnd(null); }}
                    className={`rounded-md border px-3 py-1.5 text-sm transition ${
                      extracting
                        ? "border-gray-200 text-gray-400 cursor-wait dark:border-gray-700 dark:text-gray-600"
                        : selectedChapter === ch
                          ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                          : "border-gray-300 hover:border-gray-400 dark:border-gray-600"
                    }`}
                  >
                    Ch. {ch}
                  </button>
                ))}
              </div>
              {selectedChapter && (() => {
                const range = activeRanges[selectedChapter];
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
                          availableChapters: activeChapters,
                          chapterPageRanges: activeRanges,
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
