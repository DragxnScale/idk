"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface BookmarkItem {
  id: string;
  pageNumber: number;
  type: string;
  highlightText: string | null;
  color: string | null;
  docTitle: string | null;
  pdfUrl: string | null;
}

export default function PageViewerModal({
  item,
  onClose,
  onDelete,
}: {
  item: BookmarkItem;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(item.pageNumber);
  const [containerWidth, setContainerWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setPageNum(item.pageNumber);
  }, [item.pageNumber]);

  const measureWidth = useCallback(() => {
    if (containerRef.current) {
      setContainerWidth(containerRef.current.clientWidth);
    }
  }, []);

  useEffect(() => {
    measureWidth();
    window.addEventListener("resize", measureWidth);
    return () => window.removeEventListener("resize", measureWidth);
  }, [measureWidth]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!item.pdfUrl) return null;

  const renderWidth = containerWidth || 600;
  // Proxy external URLs to avoid CORS; keep blob/local URLs as-is
  const isExternal = item.pdfUrl.startsWith("http");
  const proxiedUrl = isExternal
    ? `/api/proxy/pdf?url=${encodeURIComponent(item.pdfUrl)}`
    : item.pdfUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[90vh] rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">
              {item.docTitle ?? "Document"}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {item.type === "bookmark"
                ? `Bookmarked page ${item.pageNumber}`
                : `Highlight on page ${item.pageNumber}`}
              {item.highlightText && (
                <span className="ml-1 text-gray-400">
                  — &ldquo;{item.highlightText.slice(0, 50)}{item.highlightText.length > 50 ? "…" : ""}&rdquo;
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
            <button
              onClick={async () => {
                setDeleting(true);
                await onDelete(item.id);
                setDeleting(false);
              }}
              disabled={deleting}
              className="rounded-lg border border-red-200 dark:border-red-800 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition disabled:opacity-50"
            >
              {deleting ? "Removing…" : item.type === "bookmark" ? "Remove Bookmark" : "Remove Highlight"}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Page navigation */}
        {numPages > 0 && (
          <div className="flex items-center justify-center gap-3 border-b border-gray-200 dark:border-gray-700 px-4 py-2 flex-shrink-0">
            <button
              onClick={() => setPageNum((p) => Math.max(1, p - 1))}
              disabled={pageNum <= 1}
              className="rounded-md px-2 py-1 text-xs font-medium hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-700"
            >
              ‹ Prev
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
              Page {pageNum} of {numPages}
            </span>
            <button
              onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
              disabled={pageNum >= numPages}
              className="rounded-md px-2 py-1 text-xs font-medium hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-700"
            >
              Next ›
            </button>
          </div>
        )}

        {/* PDF viewer */}
        <div ref={containerRef} className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-950 flex justify-center p-2">
          <Document
            file={proxiedUrl}
            onLoadSuccess={({ numPages: total }) => setNumPages(total)}
            loading={
              <div className="flex min-h-[300px] items-center justify-center">
                <div className="h-6 w-6 rounded-full border-2 border-gray-300 border-t-black animate-spin dark:border-gray-600 dark:border-t-white" />
              </div>
            }
            error={
              <div className="flex min-h-[200px] items-center justify-center p-6">
                <p className="text-sm text-red-600 dark:text-red-400">Failed to load PDF</p>
              </div>
            }
          >
            <Page
              pageNumber={pageNum}
              width={Math.min(renderWidth - 16, 800)}
              loading={
                <div className="flex min-h-[300px] items-center justify-center">
                  <div className="h-6 w-6 rounded-full border-2 border-gray-300 border-t-black animate-spin dark:border-gray-600 dark:border-t-white" />
                </div>
              }
            />
          </Document>
        </div>
      </div>
    </div>
  );
}
