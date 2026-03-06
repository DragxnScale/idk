"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { getPdfZoom } from "@/lib/prefs";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.15;

const HIGHLIGHT_TAGS = [
  { id: "definition", label: "Definition", icon: "D" },
  { id: "key_concept", label: "Key Concept", icon: "K" },
  { id: "review", label: "Review Later", icon: "R" },
  { id: "important", label: "Important", icon: "!" },
] as const;

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function mapNormalizedIndex(original: string, normIdx: number): number {
  let ni = 0;
  let inSpace = false;
  for (let i = 0; i < original.length; i++) {
    if (/\s/.test(original[i])) {
      if (!inSpace && ni > 0) {
        inSpace = true;
        if (ni >= normIdx) return i;
        ni++;
      }
    } else {
      inSpace = false;
      if (ni >= normIdx) return i;
      ni++;
    }
  }
  return original.length;
}

interface BookmarkRow {
  id: string;
  pageNumber: number;
  type: "bookmark" | "highlight";
  label: string | null;
  highlightText: string | null;
  color: string | null;
  tag: string | null;
}

interface PdfViewerProps {
  url: string;
  initialPage?: number;
  jumpToPage?: number | null;
  documentId?: string;
  sessionId?: string;
  chapterPageRanges?: Record<string, [number, number]>;
  onPageChange?: (page: number) => void;
  onPageText?: (page: number, text: string) => void;
  onLoad?: () => void;
}

export function PdfViewer({ url, initialPage = 1, jumpToPage, documentId, sessionId, chapterPageRanges, onPageChange, onPageText, onLoad }: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [baseZoom, setBaseZoom] = useState(1);
  const [localZoom, setLocalZoom] = useState(1);
  const [showZoomBadge, setShowZoomBadge] = useState(false);
  const zoomBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [bookmarkItems, setBookmarkItems] = useState<BookmarkRow[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [savingBookmark, setSavingBookmark] = useState(false);
  const [hlPopover, setHlPopover] = useState<{ id: string; x: number; y: number; text: string; color: string; tag: string | null } | null>(null);

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ page: number; snippet: string }[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // TOC state
  const [showToc, setShowToc] = useState(false);

  // Tag picker for highlights
  const [tagPickerFor, setTagPickerFor] = useState<string | null>(null);

  const pdfDocRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const extractedPagesRef = useRef<Set<number>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageWrapRef = useRef<HTMLDivElement>(null);
  const [innerHeight, setInnerHeight] = useState(800);

  const isBlobServe = url.includes("/api/blob/serve");
  const pdfOptions = useMemo(() =>
    isBlobServe ? { disableAutoFetch: true, disableStream: true } : {},
    [isBlobServe]
  );

  const effectiveZoom = baseZoom * localZoom;
  const renderWidth = containerWidth || 600;

  useEffect(() => {
    const el = pageWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setInnerHeight(el.scrollHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
      if (e.key === "bowlbeacon-pdf-zoom") setBaseZoom(getPdfZoom());
    }
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("resize", updateWidth);
      window.removeEventListener("storage", onStorage);
      if (zoomBadgeTimerRef.current) clearTimeout(zoomBadgeTimerRef.current);
    };
  }, []);

  // Ctrl+scroll and trackpad pinch
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      setLocalZoom((prev) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta));
        return Math.round(next * 100) / 100;
      });
      flashZoomBadge();
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [flashZoomBadge]);

  // Touch pinch-to-zoom
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    let lastDist = 0;
    function getDistance(touches: TouchList) {
      const [a, b] = [touches[0], touches[1]];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) lastDist = getDistance(e.touches);
    }
    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const dist = getDistance(e.touches);
      if (lastDist > 0) {
        const scale = dist / lastDist;
        setLocalZoom((prev) => {
          const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev * scale));
          return Math.round(next * 100) / 100;
        });
        flashZoomBadge();
      }
      lastDist = dist;
    }
    function onTouchEnd() { lastDist = 0; }
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [flashZoomBadge]);

  const onLoadRef = useRef(onLoad);
  useEffect(() => { onLoadRef.current = onLoad; }, [onLoad]);

  const onDocumentLoadSuccess = useCallback((pdf: { numPages: number }) => {
    setNumPages(pdf.numPages);
    setLoading(false);
    pdfDocRef.current = pdf as unknown as pdfjs.PDFDocumentProxy;
    onLoadRef.current?.();
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(err.message);
    setLoading(false);
  }, []);

  const visitedPagesRef = useRef<Set<number>>(new Set([initialPage]));
  const pageNumberRef = useRef(initialPage);

  // Page visit tracking
  const pageVisitRef = useRef<{ pageNumber: number; enteredAt: number } | null>(null);
  const pendingVisitsRef = useRef<{ sessionId: string; pageNumber: number; enteredAt: string; leftAt: string; durationSeconds: number }[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPageVisits = useCallback(() => {
    const batch = pendingVisitsRef.current.splice(0);
    if (batch.length === 0 || !sessionId) return;
    navigator.sendBeacon?.(
      "/api/page-visits/batch",
      new Blob([JSON.stringify({ visits: batch })], { type: "application/json" })
    ) ||
      fetch("/api/page-visits/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visits: batch }),
        keepalive: true,
      }).catch(() => {});
  }, [sessionId]);

  const recordPageLeave = useCallback(() => {
    const cur = pageVisitRef.current;
    if (!cur || !sessionId) return;
    const now = Date.now();
    const dur = Math.round((now - cur.enteredAt) / 1000);
    if (dur >= 1) {
      pendingVisitsRef.current.push({
        sessionId,
        pageNumber: cur.pageNumber,
        enteredAt: new Date(cur.enteredAt).toISOString(),
        leftAt: new Date(now).toISOString(),
        durationSeconds: dur,
      });
    }
    pageVisitRef.current = null;
  }, [sessionId]);

  const recordPageEnter = useCallback((page: number) => {
    pageVisitRef.current = { pageNumber: page, enteredAt: Date.now() };
  }, []);

  // Start tracking the initial page
  useEffect(() => {
    if (sessionId) recordPageEnter(initialPage);
    return () => {
      recordPageLeave();
      flushPageVisits();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Periodic flush every 30s
  useEffect(() => {
    if (!sessionId) return;
    const interval = setInterval(() => {
      recordPageLeave();
      flushPageVisits();
      recordPageEnter(pageNumberRef.current);
    }, 30000);
    return () => clearInterval(interval);
  }, [sessionId, recordPageLeave, flushPageVisits, recordPageEnter]);

  // Flush on visibilitychange / beforeunload
  useEffect(() => {
    if (!sessionId) return;
    const handleUnload = () => {
      recordPageLeave();
      flushPageVisits();
    };
    const handleVis = () => {
      if (document.hidden) handleUnload();
    };
    window.addEventListener("beforeunload", handleUnload);
    document.addEventListener("visibilitychange", handleVis);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      document.removeEventListener("visibilitychange", handleVis);
    };
  }, [sessionId, recordPageLeave, flushPageVisits]);

  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(page, numPages));
      // Record leaving the current page and entering the new one
      if (sessionId && clamped !== pageNumberRef.current) {
        recordPageLeave();
        recordPageEnter(clamped);
        // Schedule a flush
        if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
        flushTimerRef.current = setTimeout(flushPageVisits, 10000);
      }
      visitedPagesRef.current.add(clamped);
      pageNumberRef.current = clamped;
      setPageNumber(clamped);
      onPageChange?.(clamped);
    },
    [numPages, onPageChange, sessionId, recordPageLeave, recordPageEnter, flushPageVisits]
  );

  useEffect(() => {
    if (jumpToPage != null && jumpToPage !== pageNumberRef.current && numPages > 0) {
      goToPage(jumpToPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToPage, numPages]);

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

  // Bookmarks: fetch on mount
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
  }, [documentId, pageNumber, isCurrentPageBookmarked, bookmarkItems, savingBookmark, sessionId]);

  const saveHighlight = useCallback(async (text: string, color: string, tag?: string) => {
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
        tag: tag ?? null,
        sessionId,
      }),
    });
    if (res.ok) {
      const row = await res.json();
      setBookmarkItems((prev) => [...prev, row].sort((a, b) => a.pageNumber - b.pageNumber));
    }
    setSelectedText("");
    window.getSelection()?.removeAllRanges();
  }, [documentId, pageNumber, sessionId]);

  const updateTag = useCallback(async (id: string, tag: string | null) => {
    await fetch("/api/bookmarks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, tag }),
    });
    setBookmarkItems((prev) => prev.map((b) => b.id === id ? { ...b, tag } : b));
    setTagPickerFor(null);
  }, []);

  const deleteItem = useCallback(async (id: string) => {
    await fetch(`/api/bookmarks?id=${id}`, { method: "DELETE" });
    setBookmarkItems((prev) => prev.filter((b) => b.id !== id));
  }, []);

  // Text selection detection
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    function onPointerUp() {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      setSelectedText(text);
    }
    el.addEventListener("pointerup", onPointerUp);
    return () => el.removeEventListener("pointerup", onPointerUp);
  }, []);

  // Search within PDF
  const runSearch = useCallback(async () => {
    if (!searchQuery.trim() || !pdfDocRef.current) return;
    setSearchLoading(true);
    const doc = pdfDocRef.current;
    const results: { page: number; snippet: string }[] = [];
    const needle = searchQuery.toLowerCase();

    for (let p = 1; p <= doc.numPages && results.length < 50; p++) {
      try {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
        const lower = text.toLowerCase();
        const idx = lower.indexOf(needle);
        if (idx !== -1) {
          const start = Math.max(0, idx - 30);
          const end = Math.min(text.length, idx + needle.length + 30);
          results.push({
            page: p,
            snippet: (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : ""),
          });
        }
      } catch {
        // skip unreadable pages
      }
    }
    setSearchResults(results);
    setSearchLoading(false);
  }, [searchQuery]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          goToPage(pageNumberRef.current - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          goToPage(pageNumberRef.current + 1);
          break;
        case "b":
        case "B":
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            toggleBookmark();
          }
          break;
        case "f":
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            setShowSearch((v) => !v);
          }
          break;
        case "Escape":
          if (showSearch) setShowSearch(false);
          if (showToc) setShowToc(false);
          if (showBookmarks) setShowBookmarks(false);
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goToPage, toggleBookmark, showSearch, showToc, showBookmarks]);

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

  const scaledW = Math.round(renderWidth * effectiveZoom);
  const scaledH = Math.round(innerHeight * effectiveZoom);

  // TOC entries from chapterPageRanges
  const tocEntries = chapterPageRanges
    ? Object.entries(chapterPageRanges)
        .map(([ch, [start, end]]) => ({ chapter: ch, start, end }))
        .sort((a, b) => a.start - b.start)
    : [];

  // Apply highlight overlays
  const applyHighlightOverlays = useCallback(() => {
    const container = pageWrapRef.current;
    if (!container) return;

    container.querySelectorAll("mark[data-hl]").forEach((el) => {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });

    const textLayer = container.querySelector(".react-pdf__Page__textContent");
    if (!textLayer) return;

    const pageHighlights = bookmarkItems.filter(
      (b) => b.type === "highlight" && b.pageNumber === pageNumber && b.highlightText
    );
    if (pageHighlights.length === 0) return;

    const hlColorMap: Record<string, string> = {
      yellow: "rgba(250, 204, 21, 0.4)",
      green: "rgba(52, 211, 153, 0.4)",
      blue: "rgba(96, 165, 250, 0.4)",
      pink: "rgba(244, 114, 182, 0.4)",
    };

    for (const hl of pageHighlights) {
      const needle = normalizeText(hl.highlightText!);
      if (!needle) continue;

      const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
      const textNodes: { node: Text; start: number; text: string }[] = [];
      let fullText = "";
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        const t = node.textContent ?? "";
        textNodes.push({ node, start: fullText.length, text: t });
        fullText += t;
      }

      const normalizedFull = normalizeText(fullText);
      const idx = normalizedFull.indexOf(needle);
      if (idx === -1) continue;

      const origStart = mapNormalizedIndex(fullText, idx);
      const origEnd = mapNormalizedIndex(fullText, idx + needle.length);

      for (const tn of textNodes) {
        const tnEnd = tn.start + tn.text.length;
        const overlapStart = Math.max(origStart, tn.start);
        const overlapEnd = Math.min(origEnd, tnEnd);
        if (overlapStart >= overlapEnd) continue;

        const localStart = overlapStart - tn.start;
        const localEnd = overlapEnd - tn.start;

        try {
          const range = document.createRange();
          range.setStart(tn.node, localStart);
          range.setEnd(tn.node, localEnd);

          const mark = document.createElement("mark");
          mark.setAttribute("data-hl", hl.id);
          mark.style.backgroundColor = hlColorMap[hl.color ?? "yellow"] ?? hlColorMap.yellow;
          mark.style.borderRadius = "2px";
          mark.style.padding = "0";
          mark.style.cursor = "pointer";
          mark.addEventListener("click", (e) => {
            e.stopPropagation();
            const rect = mark.getBoundingClientRect();
            setHlPopover({
              id: hl.id,
              x: rect.left + rect.width / 2,
              y: rect.top,
              text: hl.highlightText?.slice(0, 60) ?? "",
              color: hl.color ?? "yellow",
              tag: hl.tag,
            });
          });
          range.surroundContents(mark);
        } catch {
          // surroundContents can fail if range crosses element boundaries
        }
      }
    }
  }, [bookmarkItems, pageNumber]);

  const highlightsOnPage = bookmarkItems.filter(
    (b) => b.type === "highlight" && b.pageNumber === pageNumber
  ).length;
  useEffect(() => {
    if (highlightsOnPage > 0) {
      const t = setTimeout(applyHighlightOverlays, 50);
      return () => clearTimeout(t);
    }
  }, [highlightsOnPage, applyHighlightOverlays]);

  useEffect(() => {
    if (!hlPopover) return;
    function dismiss() { setHlPopover(null); }
    window.addEventListener("click", dismiss);
    return () => window.removeEventListener("click", dismiss);
  }, [hlPopover]);
  useEffect(() => { setHlPopover(null); }, [pageNumber]);

  const removeHighlight = useCallback(async (id: string) => {
    setHlPopover(null);
    await deleteItem(id);
  }, [deleteItem]);

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-2 w-full">
      {/* Toolbar */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 w-full">
        <div className="flex items-center justify-between px-2 py-1.5 sm:px-3 sm:py-2 gap-1">
          {/* Page navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => goToPage(pageNumber - 1)}
              disabled={pageNumber <= 1}
              className="rounded-md px-1.5 py-1 text-xs sm:text-sm font-medium hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-700"
              aria-label="Previous page"
            >
              ‹
            </button>
            <div className="flex items-center gap-1 text-xs sm:text-sm">
              <input
                type="number"
                min={1}
                max={numPages || 1}
                value={pageNumber}
                onChange={(e) => goToPage(Number(e.target.value))}
                className="w-10 sm:w-14 rounded border border-gray-300 bg-transparent px-1 py-0.5 text-center text-xs sm:text-sm dark:border-gray-600"
              />
              <span className="text-gray-500 dark:text-gray-400">/ {numPages || "…"}</span>
            </div>
            <button
              onClick={() => goToPage(pageNumber + 1)}
              disabled={pageNumber >= numPages}
              className="rounded-md px-1.5 py-1 text-xs sm:text-sm font-medium hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-700"
              aria-label="Next page"
            >
              ›
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-0.5">
            <button onClick={() => adjustZoom(-ZOOM_STEP)} disabled={localZoom <= MIN_ZOOM} className="rounded-md px-1.5 py-1 text-sm font-bold hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-700 leading-none" aria-label="Zoom out">−</button>
            <button onClick={resetZoom} className="rounded-md px-1.5 py-0.5 text-[11px] font-mono tabular-nums hover:bg-gray-100 dark:hover:bg-gray-700 min-w-[2.5rem] text-center" aria-label="Reset zoom">{Math.round(effectiveZoom * 100)}%</button>
            <button onClick={() => adjustZoom(ZOOM_STEP)} disabled={localZoom >= MAX_ZOOM} className="rounded-md px-1.5 py-1 text-sm font-bold hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-700 leading-none" aria-label="Zoom in">+</button>
          </div>

          {/* Tools: Search, TOC, Bookmark */}
          <div className="flex items-center gap-0.5">
            {/* Search */}
            <button
              onClick={() => { setShowSearch((v) => !v); setShowToc(false); setShowBookmarks(false); }}
              className={`rounded-md px-1.5 py-1 text-xs transition ${showSearch ? "bg-gray-200 dark:bg-gray-600" : "hover:bg-gray-100 dark:hover:bg-gray-700"}`}
              aria-label="Search (F)"
              title="Search (F)"
            >
              🔍
            </button>

            {/* TOC */}
            {tocEntries.length > 0 && (
              <button
                onClick={() => { setShowToc((v) => !v); setShowSearch(false); setShowBookmarks(false); }}
                className={`rounded-md px-1.5 py-1 text-xs transition ${showToc ? "bg-gray-200 dark:bg-gray-600" : "hover:bg-gray-100 dark:hover:bg-gray-700"}`}
                aria-label="Table of Contents"
                title="Table of Contents"
              >
                📑
              </button>
            )}

            {documentId && (
              <>
                <button
                  onClick={toggleBookmark}
                  disabled={savingBookmark}
                  className={`rounded-md px-1.5 py-1 text-sm transition ${
                    isCurrentPageBookmarked
                      ? "text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                      : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                  }`}
                  aria-label={isCurrentPageBookmarked ? "Remove bookmark (B)" : "Bookmark this page (B)"}
                  title={isCurrentPageBookmarked ? "Remove bookmark (B)" : "Bookmark (B)"}
                >
                  {isCurrentPageBookmarked ? "★" : "☆"}
                </button>

                <div className="relative">
                  <button
                    onClick={() => { setShowBookmarks((v) => !v); setShowSearch(false); setShowToc(false); }}
                    className={`rounded-md px-1.5 py-1 text-[11px] transition ${showBookmarks ? "bg-gray-200 dark:bg-gray-600" : "hover:bg-gray-100 dark:hover:bg-gray-700"}`}
                  >
                    {bookmarkCount}
                  </button>

                  {showBookmarks && (
                    <div className="absolute right-0 top-full mt-2 z-50 w-72 max-h-80 overflow-auto rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
                      {bookmarkItems.length === 0 ? (
                        <p className="p-4 text-xs text-gray-500 text-center">
                          No bookmarks or highlights yet.<br />
                          Click ☆ or press B to bookmark. Select text to highlight.
                        </p>
                      ) : (
                        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                          {bookmarkItems.map((item) => (
                            <li key={item.id} className="group flex items-start gap-2 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                              <button
                                onClick={() => { goToPage(item.pageNumber); setShowBookmarks(false); }}
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
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                      <span className="text-[10px] text-gray-400">Page {item.pageNumber}</span>
                                      {item.tag && (
                                        <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                                          {HIGHLIGHT_TAGS.find((t) => t.id === item.tag)?.label ?? item.tag}
                                        </span>
                                      )}
                                    </div>
                                    <p className={`text-xs rounded px-1.5 py-0.5 line-clamp-2 ${colorClasses[item.color ?? "yellow"]}`}>
                                      &ldquo;{item.highlightText}&rdquo;
                                    </p>
                                  </div>
                                )}
                              </button>
                              <div className="flex items-center gap-1">
                                {item.type === "highlight" && (
                                  <div className="relative">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setTagPickerFor(tagPickerFor === item.id ? null : item.id); }}
                                      className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-blue-500 transition mt-0.5"
                                      title="Tag"
                                    >
                                      #
                                    </button>
                                    {tagPickerFor === item.id && (
                                      <div className="absolute right-0 top-full mt-1 z-50 w-36 rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800 py-1" onClick={(e) => e.stopPropagation()}>
                                        {HIGHLIGHT_TAGS.map((t) => (
                                          <button
                                            key={t.id}
                                            onClick={() => updateTag(item.id, item.tag === t.id ? null : t.id)}
                                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700/50 ${item.tag === t.id ? "font-semibold text-blue-600 dark:text-blue-400" : ""}`}
                                          >
                                            {t.icon} {t.label}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <button
                                  onClick={() => deleteItem(item.id)}
                                  className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-red-500 transition mt-0.5"
                                  title="Delete"
                                >
                                  ×
                                </button>
                              </div>
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
        </div>
      </div>

      {/* Search panel */}
      {showSearch && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 w-full p-3">
          <form onSubmit={(e) => { e.preventDefault(); runSearch(); }} className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in document…"
              autoFocus
              className="flex-1 rounded-md border border-gray-300 bg-transparent px-2.5 py-1.5 text-sm dark:border-gray-600"
            />
            <button type="submit" disabled={searchLoading || !searchQuery.trim()} className="btn-primary rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-40">
              {searchLoading ? "…" : "Search"}
            </button>
          </form>
          {searchResults.length > 0 && (
            <ul className="mt-2 max-h-48 overflow-auto divide-y divide-gray-100 dark:divide-gray-700">
              {searchResults.map((r, i) => (
                <li key={i}>
                  <button
                    onClick={() => { goToPage(r.page); setShowSearch(false); }}
                    className="w-full text-left px-2 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <span className="text-[10px] font-medium text-gray-400">Page {r.page}</span>
                    <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2">{r.snippet}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searchResults.length === 0 && searchQuery && !searchLoading && (
            <p className="mt-2 text-xs text-gray-500 text-center">No results found.</p>
          )}
          <p className="mt-2 text-[10px] text-gray-400 text-center">
            Shortcuts: ← → pages · B bookmark · F search · Esc close
          </p>
        </div>
      )}

      {/* TOC panel */}
      {showToc && tocEntries.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 w-full max-h-60 overflow-auto">
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
            <p className="text-xs font-semibold">Table of Contents</p>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {tocEntries.map(({ chapter, start, end }) => {
              const isActive = pageNumber >= start && pageNumber <= end;
              return (
                <li key={chapter}>
                  <button
                    onClick={() => { goToPage(start); setShowToc(false); }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-gray-700/50 flex justify-between items-center ${isActive ? "font-semibold bg-blue-50 dark:bg-blue-900/20" : ""}`}
                  >
                    <span>Chapter {chapter}</span>
                    <span className="text-gray-400">p. {start}–{end}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Highlight save bar */}
      {selectedText && documentId && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800 w-full">
          <span className="text-xs text-gray-500 truncate flex-1 min-w-0">
            &ldquo;{selectedText.slice(0, 60)}{selectedText.length > 60 ? "…" : ""}&rdquo;
          </span>
          {highlightColors.map((c) => (
            <button
              key={c}
              onClick={() => saveHighlight(selectedText, c)}
              className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 ${colorClasses[c]} ${colorBorders[c]} hover:scale-110 transition flex-shrink-0`}
              title={`Save as ${c} highlight`}
            />
          ))}
          <button
            onClick={() => { setSelectedText(""); window.getSelection()?.removeAllRanges(); }}
            className="text-xs text-gray-400 hover:text-gray-600 ml-1 flex-shrink-0"
          >
            ×
          </button>
        </div>
      )}

      {/* PDF canvas */}
      <div
        ref={scrollContainerRef}
        className="relative w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow dark:border-gray-700 touch-pan-x touch-pan-y"
      >
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
          <div style={{ width: scaledW, height: scaledH, overflow: "hidden" }}>
            <div
              ref={pageWrapRef}
              style={{ transform: `scale(${effectiveZoom})`, transformOrigin: "top left", width: renderWidth }}
            >
              <Document
                file={url}
                options={pdfOptions}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={onDocumentLoadError}
                loading={<div className="flex min-h-[300px] items-center justify-center"><div className="spinner" /></div>}
              >
                <Page
                  pageNumber={pageNumber}
                  width={renderWidth}
                  onRenderSuccess={applyHighlightOverlays}
                  loading={<div className="flex min-h-[300px] items-center justify-center"><div className="spinner" /></div>}
                />
              </Document>
            </div>
          </div>
        )}
      </div>

      {loading && !error && (
        <p className="text-sm text-gray-500 animate-pulse">Loading document…</p>
      )}

      {/* Highlight tap popover */}
      {hlPopover && (
        <div
          className="fixed z-[60] -translate-x-1/2 -translate-y-full animate-in fade-in"
          style={{ left: hlPopover.x, top: hlPopover.y - 8 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-xl dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-2.5 mb-1">
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-[150px] truncate">
                &ldquo;{hlPopover.text}&rdquo;
              </p>
              <button
                onClick={() => removeHighlight(hlPopover.id)}
                className="rounded-md border border-red-200 dark:border-red-800 px-2.5 py-1 text-[11px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition whitespace-nowrap"
              >
                Remove
              </button>
            </div>
            {/* Tag buttons in popover */}
            <div className="flex gap-1 flex-wrap">
              {HIGHLIGHT_TAGS.map((t) => (
                <button
                  key={t.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateTag(hlPopover.id, hlPopover.tag === t.id ? null : t.id);
                    setHlPopover((prev) => prev ? { ...prev, tag: prev.tag === t.id ? null : t.id } : null);
                  }}
                  className={`rounded px-1.5 py-0.5 text-[10px] border transition ${
                    hlPopover.tag === t.id
                      ? "border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-600"
                      : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  }`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mx-auto w-2.5 h-2.5 rotate-45 bg-white border-b border-r border-gray-200 dark:border-gray-700 dark:bg-gray-800 -mt-[5px]" />
        </div>
      )}
    </div>
  );
}
