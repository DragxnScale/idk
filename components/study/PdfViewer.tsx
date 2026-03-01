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

interface PdfViewerProps {
  url: string;
  initialPage?: number;
  jumpToPage?: number | null;
  onPageChange?: (page: number) => void;
  onPageText?: (page: number, text: string) => void;
}

export function PdfViewer({ url, initialPage = 1, jumpToPage, onPageChange, onPageText }: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(960);
  // baseZoom = user's setting preference; localZoom = scroll/pinch adjustment this session
  const [baseZoom, setBaseZoom] = useState(1);
  const [localZoom, setLocalZoom] = useState(1);
  const [showZoomBadge, setShowZoomBadge] = useState(false);
  const zoomBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      </div>

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
