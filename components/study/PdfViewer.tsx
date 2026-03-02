"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { getPdfZoom } from "@/lib/prefs";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.15;

interface BookmarkRow {
  id: string;
  pageNumber: number;
  type: "bookmark" | "highlight";
  label: string | null;
  highlightText: string | null;
  color: string | null;
}

interface PdfViewerProps {
  url: string;
  initialPage?: number;
  jumpToPage?: number | null;
  documentId?: string;
  sessionId?: string;
  onPageChange?: (page: number) => void;
  onPageText?: (page: number, text: string) => void;
}

export function PdfViewer({ url, initialPage = 1, jumpToPage, documentId, sessionId, onPageChange, onPageText }: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(960);
  const [baseZoom, setBaseZoom] = useState(1);
  const [localZoom, setLocalZoom] = useState(1);
  const [showZoomBadge, setShowZoomBadge] = useState(false);
  const zoomBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [bookmarkItems, setBookmarkItems] = useState<BookmarkRow[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [savingBookmark, setSavingBookmark] = useState(false);

  const pdfDocRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const extractedPagesRef = useRef<Set<number>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const effectiveZoom = baseZoom * localZoom;
  const pageWidth = Math.round(containerWidth * effectiveZoom);

  // Flash the zoom badge and auto-hide it after 1.5 s
  const flashZoomBadge = useCallback(() => {
    setShowZoomBadge(true);
    if (zoomBadgeTimerRef.current) clearTimeout(zoomBadgeTimerRef.current);
    zoomBadgeTimerRef.current = setTimeout(() => setShowZoomBadge(false), 1500);
  }, []);

  const adjustZoom = useCallback((delta: number) => {
    setLocalZoom((prev) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta));
      return Math.round(next * 100) / 100;
    });
    flashZoomBadge();
  }, [flashZoomBadge]);

  const resetZoom = useCallback(() => {
    setLocalZoom(1);
    flashZoomBadge();
  }, [flashZoomBadge]);

  // Load base zoom from settings & listen for changes
  useEffect(() => {
    setBaseZoom(getPdfZoom());

    function updateWidth() {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth - 2);
      }
    }
    updateWidth();
    window.addEventListener("resize", updateWidth);

    function onStorage(e: StorageEvent) {
      if (e.key === "studyfocus-pdf-zoom") setBaseZoom(getPdfZoom());
    }
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("resize", updateWidth);
      window.removeEventListener("storage", onStorage);
      if (zoomBadgeTimerRef.current) clearTimeout(zoomBadgeTimerRef.current);
    };
  }, []);

  // Ctrl+scroll and pinch-to-zoom (browsers fire wheel with ctrlKey for pinch)
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // deltaY < 0 = scroll up = zoom in
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      setLocalZoom((prev) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta));
        return Math.round(next * 100) / 100;
      });
      flashZoomBadge();
    }

    // passive:false so we can call preventDefault
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [flashZoomBadge]);

  const onDocumentLoadSuccess = useCallback(({ numPages: total }: { numPages: number }) => {
    setNumPages(total);
    setLoading(false);
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(err.message);
    setLoading(false);
  }, []);

  const visitedPagesRef = useRef<Set<number>>(new Set([initialPage]));
  const pageNumberRef = useRef(initialPage);

  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(page, numPages));
      visitedPagesRef.current.add(clamped);
      pageNumberRef.current = clamped;
      setPageNumber(clamped);
      onPageChange?.(clamped);
    },
    [numPages, onPageChange]
  );

  useEffect(() => {
    if (jumpToPage != null && jumpToPage !== pageNumberRef.current && numPages > 0) {
      goToPage(jumpToPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToPage, numPages]);

  useEffect(() => {
    if (!url || !onPageText) return;
    let cancelled = false;
    pdfjs.getDocument(url).promise.then((doc) => {
      if (!cancelled) pdfDocRef.current = doc;
    });
    return () => { cancelled = true; };
  }, [url, onPageText]);

  useEffect(() => {
    if (!pdfDocRef.current || !onPageText) return;
    if (extractedPagesRef.current.has(pageNumber)) return;
    const doc = pdfDocRef.current;
    doc.getPage(pageNumber).then((page) => {
      page.getTextContent().then((content) => {
        const text = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");
        if (text.trim()) {
          extractedPagesRef.current.add(pageNumber);
          onPageText(pageNumber, text);
        }
      });
    });
  }, [pageNumber, onPageText]);

  // Bookmarks: fetch on mount (session-scoped when sessionId provided)
  useEffect(() => {
    if (!documentId) return;
    const params = new URLSearchParams({ documentId });
    if (sessionId) params.set("sessionId", sessionId);
    fetch(`/api/bookmarks?${params}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setBookmarkItems)
      .catch(() => {});
  }, [documentId, sessionId]);

  const isCurrentPageBookmarked = bookmarkItems.some(
    (b) => b.type === "bookmark" && b.pageNumber === pageNumber
  );

  const toggleBookmark = useCallback(async () => {
    if (!documentId || savingBookmark) return;
    setSavingBookmark(true);
    try {
      if (isCurrentPageBookmarked) {
        const existing = bookmarkItems.find(
          (b) => b.type === "bookmark" && b.pageNumber === pageNumber
        );
        if (existing) {
          await fetch(`/api/bookmarks?id=${existing.id}`, { method: "DELETE" });
          setBookmarkItems((prev) => prev.filter((b) => b.id !== existing.id));
        }
      } else {
        const res = await fetch("/api/bookmarks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId, pageNumber, type: "bookmark", sessionId }),
        });
        if (res.ok) {
          const row = await res.json();
          setBookmarkItems((prev) => [...prev, row].sort((a, b) => a.pageNumber - b.pageNumber));
        }
      }
    } finally {
      setSavingBookmark(false);
    }
  }, [documentId, pageNumber, isCurrentPageBookmarked, bookmarkItems, savingBookmark]);

  const saveHighlight = useCallback(async (text: string, color: string) => {
    if (!documentId || !text.trim()) return;
    const res = await fetch("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId,
        pageNumber,
        type: "highlight",
        highlightText: text.trim().slice(0, 500),
        color,
        sessionId,
      }),
    });
    if (res.ok) {
      const row = await res.json();
      setBookmarkItems((prev) => [...prev, row].sort((a, b) => a.pageNumber - b.pageNumber));
    }
    setSelectedText("");
    window.getSelection()?.removeAllRanges();
  }, [documentId, pageNumber]);

  const deleteItem = useCallback(async (id: string) => {
    await fetch(`/api/bookmarks?id=${id}`, { method: "DELETE" });
    setBookmarkItems((prev) => prev.filter((b) => b.id !== id));
  }, []);

  // Detect text selection inside the PDF
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    function onMouseUp() {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      setSelectedText(text);
    }
    el.addEventListener("mouseup", onMouseUp);
    return () => el.removeEventListener("mouseup", onMouseUp);
  }, []);

  const bookmarkCount = bookmarkItems.length;
  const highlightColors = ["yellow", "green", "blue", "pink"] as const;
  const colorClasses: Record<string, string> = {
    yellow: "bg-yellow-200 dark:bg-yellow-800/40",
    green: "bg-emerald-200 dark:bg-emerald-800/40",
    blue: "bg-blue-200 dark:bg-blue-800/40",
    pink: "bg-pink-200 dark:bg-pink-800/40",
  };
  const colorBorders: Record<string, string> = {
    yellow: "border-yellow-400",
    green: "border-emerald-400",
    blue: "border-blue-400",
    pink: "border-pink-400",
  };

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-4 w-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800 w-full max-w-full">
        {/* Page navigation */}
        <button
          onClick={() => goToPage(pageNumber - 1)}
          disabled={pageNumber <= 1}
          className="rounded-md px-2 py-1 text-sm font-medium hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-700"
          aria-label="Previous page"
        >
          ← Prev
        </button>
        <div className="flex items-center gap-1.5 text-sm">
          <input
            type="number"
            min={1}
            max={numPages || 1}
            value={pageNumber}
            onChange={(e) => goToPage(Number(e.target.value))}
            className="w-14 rounded border border-gray-300 bg-transparent px-1.5 py-0.5 text-center text-sm dark:border-gray-600"
          />
          <span className="text-gray-500 dark:text-gray-400">/ {numPages || "…"}</span>
        </div>
        <button
          onClick={() => goToPage(pageNumber + 1)}
          disabled={pageNumber >= numPages}
          className="rounded-md px-2 py-1 text-sm font-medium hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-700"
          aria-label="Next page"
        >
          Next →
        </button>

        {/* Divider */}
        <div className="h-5 w-px bg-gray-200 dark:bg-gray-700 mx-1" />

        {/* Zoom controls */}
        <button
          onClick={() => adjustZoom(-ZOOM_STEP)}
          disabled={localZoom <= MIN_ZOOM}
          className="rounded-md px-2 py-1 text-base font-medium hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-700 leading-none"
          aria-label="Zoom out"
          title="Zoom out (Ctrl + scroll)"
        >
          −
        </button>
        <button
          onClick={resetZoom}
          className="rounded-md px-2 py-0.5 text-xs font-mono tabular-nums hover:bg-gray-100 dark:hover:bg-gray-700 min-w-[3.5rem] text-center"
          aria-label="Reset zoom"
          title="Reset zoom"
        >
          {Math.round(effectiveZoom * 100)}%
        </button>
        <button
          onClick={() => adjustZoom(ZOOM_STEP)}
          disabled={localZoom >= MAX_ZOOM}
          className="rounded-md px-2 py-1 text-base font-medium hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-700 leading-none"
          aria-label="Zoom in"
          title="Zoom in (Ctrl + scroll)"
        >
          +
        </button>

        {documentId && (
          <>
            <div className="h-5 w-px bg-gray-200 dark:bg-gray-700 mx-1" />

            {/* Bookmark toggle */}
            <button
              onClick={toggleBookmark}
              disabled={savingBookmark}
              className={`rounded-md px-2 py-1 text-sm transition ${
                isCurrentPageBookmarked
                  ? "text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                  : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              }`}
              aria-label={isCurrentPageBookmarked ? "Remove bookmark" : "Bookmark this page"}
              title={isCurrentPageBookmarked ? "Remove bookmark" : "Bookmark this page"}
            >
              {isCurrentPageBookmarked ? "★" : "☆"}
            </button>

            {/* Bookmarks list toggle */}
            <div className="relative">
              <button
                onClick={() => setShowBookmarks((v) => !v)}
                className={`rounded-md px-2 py-1 text-xs transition ${
                  showBookmarks
                    ? "bg-gray-200 dark:bg-gray-600"
                    : "hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
                title="Bookmarks & highlights"
              >
                {bookmarkCount > 0 ? `${bookmarkCount}` : "0"} saved
              </button>

              {showBookmarks && (
                <div className="absolute right-0 top-full mt-2 z-50 w-72 max-h-80 overflow-auto rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
                  {bookmarkItems.length === 0 ? (
                    <p className="p-4 text-xs text-gray-500 text-center">
                      No bookmarks or highlights yet.
                      <br />
                      Click ☆ to bookmark a page, or select text to highlight.
                    </p>
                  ) : (
                    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                      {bookmarkItems.map((item) => (
                        <li key={item.id} className="group flex items-start gap-2 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <button
                            onClick={() => {
                              goToPage(item.pageNumber);
                              setShowBookmarks(false);
                            }}
                            className="flex-1 text-left min-w-0"
                          >
                            {item.type === "bookmark" ? (
                              <p className="text-xs font-medium truncate">
                                <span className="text-amber-500 mr-1">★</span>
                                Page {item.pageNumber}
                                {item.label && <span className="text-gray-500 ml-1">— {item.label}</span>}
                              </p>
                            ) : (
                              <div>
                                <p className="text-[10px] text-gray-400 mb-0.5">
                                  Page {item.pageNumber}
                                </p>
                                <p className={`text-xs rounded px-1.5 py-0.5 line-clamp-2 ${colorClasses[item.color ?? "yellow"]}`}>
                                  &ldquo;{item.highlightText}&rdquo;
                                </p>
                              </div>
                            )}
                          </button>
                          <button
                            onClick={() => deleteItem(item.id)}
                            className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-red-500 transition mt-0.5"
                            title="Delete"
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Highlight save bar */}
      {selectedText && documentId && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800 w-full max-w-full">
          <span className="text-xs text-gray-500 truncate flex-1 min-w-0">
            &ldquo;{selectedText.slice(0, 80)}{selectedText.length > 80 ? "…" : ""}&rdquo;
          </span>
          {highlightColors.map((c) => (
            <button
              key={c}
              onClick={() => saveHighlight(selectedText, c)}
              className={`w-6 h-6 rounded-full border-2 ${colorClasses[c]} ${colorBorders[c]} hover:scale-110 transition`}
              title={`Save as ${c} highlight`}
            />
          ))}
          <button
            onClick={() => { setSelectedText(""); window.getSelection()?.removeAllRanges(); }}
            className="text-xs text-gray-400 hover:text-gray-600 ml-1"
          >
            ×
          </button>
        </div>
      )}

      {/* PDF canvas — scroll container for overflow when zoomed in */}
      <div
        ref={scrollContainerRef}
        className="relative w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow dark:border-gray-700"
      >
        {/* Floating zoom badge */}
        {showZoomBadge && (
          <div className="pointer-events-none absolute top-3 right-3 z-10 rounded-md bg-black/70 px-2.5 py-1 text-xs font-mono text-white backdrop-blur-sm">
            {Math.round(effectiveZoom * 100)}%
          </div>
        )}

        {error ? (
          <div className="flex min-h-[300px] items-center justify-center p-6">
            <p className="text-sm text-red-600 dark:text-red-400">Failed to load PDF: {error}</p>
          </div>
        ) : (
          <Document
            file={url}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="flex min-h-[300px] items-center justify-center">
                <div className="spinner" />
              </div>
            }
          >
            <Page
              pageNumber={pageNumber}
              width={pageWidth}
              loading={
                <div className="flex min-h-[300px] items-center justify-center">
                  <div className="spinner" />
                </div>
              }
            />
          </Document>
        )}
      </div>

      {loading && !error && (
        <p className="text-sm text-gray-500 animate-pulse">Loading document…</p>
      )}
    </div>
  );
}
