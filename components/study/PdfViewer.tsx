"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  url: string;
  initialPage?: number;
  onPageChange?: (page: number) => void;
  onPageText?: (page: number, text: string) => void;
}

export function PdfViewer({ url, initialPage = 1, onPageChange, onPageText }: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState(720);
  const pdfDocRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const extractedPagesRef = useRef<Set<number>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function updateWidth() {
      if (containerRef.current) {
        setContainerWidth(Math.min(containerRef.current.clientWidth - 2, 720));
      }
    }
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  const onDocumentLoadSuccess = useCallback(({ numPages: total }: { numPages: number }) => {
    setNumPages(total);
    setLoading(false);
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    setError(err.message);
    setLoading(false);
  }, []);

  const visitedPagesRef = useRef<Set<number>>(new Set([initialPage]));

  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(page, numPages));
      visitedPagesRef.current.add(clamped);
      setPageNumber(clamped);
      onPageChange?.(clamped);
    },
    [numPages, onPageChange]
  );

  useEffect(() => {
    if (!url || !onPageText) return;
    let cancelled = false;

    pdfjs.getDocument(url).promise.then((doc) => {
      if (!cancelled) pdfDocRef.current = doc;
    });

    return () => {
      cancelled = true;
    };
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
    <div className="flex flex-col items-center gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800">
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
      </div>

      {/* PDF Canvas */}
      <div ref={containerRef} className="w-full max-w-3xl overflow-auto rounded-lg border border-gray-200 bg-white shadow dark:border-gray-700">
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
              width={containerWidth}
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
