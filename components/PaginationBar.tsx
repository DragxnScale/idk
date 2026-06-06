"use client";

import { useEffect, useRef } from "react";
import { isTypingTarget } from "@/lib/is-typing-target";

export interface PaginationBarProps {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  loading?: boolean;
  className?: string;
  /** Optional center label (defaults to "Page N of M") */
  centerLabel?: React.ReactNode;
  /** Show keyboard hint below the bar */
  showKeyHint?: boolean;
  /** Dark admin theme vs light study theme */
  variant?: "dark" | "light";
  /** Extra content between prev and next (e.g. numbered page buttons) */
  children?: React.ReactNode;
}

export function PaginationBar({
  page,
  totalPages,
  onPrev,
  onNext,
  loading = false,
  className = "",
  centerLabel,
  showKeyHint = true,
  variant = "dark",
  children,
}: PaginationBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canPrev = page > 1;
  const canNext = page < totalPages;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (isTypingTarget(e.target)) return;
      if (!containerRef.current?.contains(document.activeElement)) return;
      if (loading) return;

      e.preventDefault();
      if (e.key === "ArrowLeft" && canPrev) onPrev();
      if (e.key === "ArrowRight" && canNext) onNext();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canPrev, canNext, onPrev, onNext, loading]);

  if (totalPages <= 1) return null;

  const btnClass =
    variant === "dark"
      ? "rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 transition disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400"
      : "rounded-lg border border-gray-200 px-3 py-1.5 text-xs disabled:opacity-40 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 transition";

  const labelClass =
    variant === "dark"
      ? "text-xs text-gray-500 tabular-nums"
      : "text-xs text-gray-500 dark:text-gray-400 tabular-nums";

  const hintClass =
    variant === "dark" ? "text-[10px] text-gray-600 text-center" : "text-[10px] text-gray-500 text-center";

  return (
    <div className={className}>
      <div
        ref={containerRef}
        tabIndex={0}
        role="group"
        aria-label={`Page ${page} of ${totalPages}. Use arrow keys when focused to change page.`}
        className={`outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2 rounded-lg ${
          variant === "dark" ? "focus-visible:ring-offset-gray-900" : "focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
        }`}
      >
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            disabled={!canPrev || loading}
            onClick={onPrev}
            className={btnClass}
          >
            ← Previous
          </button>
          {children ?? (
            <span className={labelClass}>
              {centerLabel ?? `Page ${page} of ${totalPages}`}
            </span>
          )}
          <button
            type="button"
            disabled={!canNext || loading}
            onClick={onNext}
            className={btnClass}
          >
            Next →
          </button>
        </div>
      </div>
      {showKeyHint && (
        <p className={`${hintClass} mt-1.5`}>
          <kbd
            className={`rounded border px-1 py-0.5 text-[10px] ${
              variant === "dark"
                ? "border-gray-600 bg-gray-800"
                : "border-gray-300 bg-gray-100 dark:border-gray-600 dark:bg-gray-800"
            }`}
          >
            ←
          </kbd>{" "}
          <kbd
            className={`rounded border px-1 py-0.5 text-[10px] ${
              variant === "dark"
                ? "border-gray-600 bg-gray-800"
                : "border-gray-300 bg-gray-100 dark:border-gray-600 dark:bg-gray-800"
            }`}
          >
            →
          </kbd>{" "}
          when focused
        </p>
      )}
    </div>
  );
}
