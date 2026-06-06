"use client";

import { useEffect, useRef, useState } from "react";
import {
  createNewTocRowAfter,
  rangesToTocRows,
  tocRowsToRanges,
  parseTocRangesJson,
  type TocRow,
} from "@/lib/toc-editor-utils";

export type TocEditorVariant = "admin" | "study";

const VARIANT_STYLES = {
  admin: {
    offsetLabel: "block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide",
    offsetInput:
      "w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono focus:outline-none focus:border-gray-500",
    offsetHint: "text-xs text-gray-600 mt-1",
    offsetHintStrong: "text-gray-400",
    chaptersLabel: "block text-xs font-medium text-gray-400 uppercase tracking-wide",
    toggleBtn:
      "text-xs text-gray-500 hover:text-gray-300 underline underline-offset-2 transition",
    jsonTextarea:
      "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-y",
    jsonHint: "text-xs text-gray-600",
    jsonHintStrong: "text-gray-400",
    applyJsonBtn:
      "rounded-lg bg-white text-black px-4 py-1.5 text-xs font-medium hover:bg-gray-200 transition",
    tableWrap: "rounded-xl border border-gray-800 overflow-x-auto",
    tableHead: "grid grid-cols-[1fr_90px_90px_36px] gap-2 px-3 py-2 bg-gray-800/50 text-xs text-gray-500 uppercase tracking-wide min-w-[350px]",
    tableRow: "grid grid-cols-[1fr_90px_90px_36px] gap-2 px-3 py-1.5 items-center min-w-[350px]",
    tableDivide: "divide-y divide-gray-800",
    cellInput:
      "rounded border border-gray-700 bg-gray-950 px-2 py-1 text-sm focus:outline-none focus:border-gray-500",
    cellMono:
      "rounded border border-gray-700 bg-gray-950 px-2 py-1 text-sm font-mono focus:outline-none focus:border-gray-500",
    removeBtn:
      "rounded p-1 text-gray-600 hover:text-red-400 hover:bg-gray-800 transition",
    addBtn:
      "w-full rounded-lg border border-dashed border-gray-700 px-4 py-2 text-xs text-gray-400 hover:border-gray-500 hover:text-gray-300 transition",
    preview: "text-xs text-gray-600",
    jsonError: "text-xs text-red-400",
  },
  study: {
    offsetLabel: "text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1",
    offsetInput:
      "w-28 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800",
    offsetHint: "text-xs text-gray-500 dark:text-gray-500 mt-1",
    offsetHintStrong: "text-gray-600 dark:text-gray-400",
    chaptersLabel: "text-xs font-medium text-gray-600 dark:text-gray-400",
    toggleBtn:
      "text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 underline underline-offset-2",
    jsonTextarea:
      "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-mono dark:border-gray-600 dark:bg-gray-800 focus:outline-none focus:border-gray-500 resize-y",
    jsonHint: "text-xs text-gray-500 dark:text-gray-500",
    jsonHintStrong: "text-gray-600 dark:text-gray-400",
    applyJsonBtn:
      "rounded-lg bg-black text-white dark:bg-white dark:text-black px-4 py-1.5 text-xs font-medium hover:opacity-90 transition",
    tableWrap: "rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto",
    tableHead:
      "grid grid-cols-[1fr_90px_90px_36px] gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800/80 text-xs text-gray-500 uppercase tracking-wide min-w-[350px]",
    tableRow:
      "grid grid-cols-[1fr_90px_90px_36px] gap-2 px-3 py-1.5 items-center min-w-[350px]",
    tableDivide: "divide-y divide-gray-200 dark:divide-gray-700",
    cellInput:
      "rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 focus:outline-none focus:border-gray-500",
    cellMono:
      "rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm font-mono dark:border-gray-600 dark:bg-gray-800 focus:outline-none focus:border-gray-500",
    removeBtn: "text-red-400 hover:text-red-600 text-sm px-1",
    addBtn:
      "w-full rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-4 py-2 text-xs text-gray-500 hover:border-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition",
    preview: "text-xs text-gray-500 dark:text-gray-500",
    jsonError: "text-xs text-red-500",
  },
} as const;

export function TocEditor({
  rows,
  onChange,
  pageOffset,
  onPageOffsetChange,
  variant = "admin",
}: {
  rows: TocRow[];
  onChange: (rows: TocRow[]) => void;
  pageOffset: number;
  onPageOffsetChange: (n: number) => void;
  variant?: TocEditorVariant;
}) {
  const s = VARIANT_STYLES[variant];
  const [showJson, setShowJson] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const endPageRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  useEffect(() => {
    if (focusIdx !== null) {
      const el = endPageRefs.current.get(focusIdx);
      if (el) el.focus();
      setFocusIdx(null);
    }
  }, [focusIdx, rows.length]);

  function updateRow(idx: number, patch: Partial<TocRow>) {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function removeRow(idx: number) {
    endPageRefs.current.delete(idx);
    onChange(rows.filter((_, i) => i !== idx));
  }

  function addRowAfter(idx?: number) {
    const newRow = createNewTocRowAfter(rows, idx);
    if (idx !== undefined) {
      const next = [...rows];
      next.splice(idx + 1, 0, newRow);
      onChange(next);
      setFocusIdx(idx + 1);
    } else {
      onChange([...rows, newRow]);
      setFocusIdx(rows.length);
    }
  }

  function openJsonView() {
    setJsonDraft(JSON.stringify(tocRowsToRanges(rows, pageOffset), null, 2));
    setJsonError(null);
    setShowJson(true);
  }

  function applyJson() {
    try {
      const parsed = parseTocRangesJson(jsonDraft);
      onChange(rangesToTocRows(parsed, pageOffset));
      setShowJson(false);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-4">
        <div className={variant === "study" ? undefined : "flex-1"}>
          <label className={s.offsetLabel}>
            Page offset
            {variant === "study" && (
              <span className="ml-1 font-normal text-gray-400">
                (PDF page 1 = book page 1 + offset)
              </span>
            )}
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={pageOffset || ""}
            onChange={(e) => onPageOffsetChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
            className={s.offsetInput}
            placeholder="0"
          />
          <p className={s.offsetHint}>
            {variant === "admin" ? (
              <>
                If the book&apos;s page 1 is on PDF page 15, enter{" "}
                <strong className={s.offsetHintStrong}>14</strong>. Chapter pages below are{" "}
                <em>book</em> pages — the offset converts them to PDF pages automatically.
              </>
            ) : (
              <>
                If the book&apos;s page 1 is PDF page 15, enter{" "}
                <strong className={s.offsetHintStrong}>14</strong>. Chapter rows use{" "}
                <em>book</em> page numbers.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <label className={s.chaptersLabel}>
          {variant === "study" ? (
            <>
              Table of contents{" "}
              <span className="font-normal text-gray-400">(book pages)</span>
            </>
          ) : (
            <>Chapters ({rows.length})</>
          )}
        </label>
        <button
          type="button"
          onClick={showJson ? () => setShowJson(false) : openJsonView}
          className={s.toggleBtn}
        >
          {showJson ? "Visual editor" : "Edit as JSON"}
        </button>
      </div>

      {showJson ? (
        <div className="space-y-2">
          <textarea
            value={jsonDraft}
            onChange={(e) => {
              setJsonDraft(e.target.value);
              setJsonError(null);
            }}
            rows={Math.min(20, Math.max(6, rows.length * 2 + 4))}
            spellCheck={false}
            className={s.jsonTextarea}
          />
          {jsonError && <p className={s.jsonError}>{jsonError}</p>}
          <p className={s.jsonHint}>
            JSON uses <strong className={s.jsonHintStrong}>PDF page numbers</strong> (offset
            already applied).
          </p>
          <button type="button" onClick={applyJson} className={s.applyJsonBtn}>
            Apply JSON
          </button>
        </div>
      ) : (
        <>
          {rows.length > 0 && (
            <div className={s.tableWrap}>
              <div className={s.tableHead}>
                <span>Chapter</span>
                <span>Start pg</span>
                <span>End pg</span>
                <span />
              </div>
              <div className={s.tableDivide}>
                {rows.map((row, idx) => (
                  <div key={idx} className={s.tableRow}>
                    <input
                      type="text"
                      value={row.label}
                      onChange={(e) => updateRow(idx, { label: e.target.value })}
                      placeholder="e.g. 1"
                      className={s.cellInput}
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={row.startPage || ""}
                      onChange={(e) =>
                        updateRow(idx, { startPage: parseInt(e.target.value, 10) || 0 })
                      }
                      placeholder="start"
                      className={s.cellMono}
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      ref={(el) => {
                        if (el) endPageRefs.current.set(idx, el);
                        else endPageRefs.current.delete(idx);
                      }}
                      value={row.endPage || ""}
                      onChange={(e) =>
                        updateRow(idx, { endPage: parseInt(e.target.value, 10) || 0 })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addRowAfter(idx);
                        }
                      }}
                      placeholder="end"
                      className={s.cellMono}
                    />
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      className={s.removeBtn}
                      title="Remove chapter"
                    >
                      {variant === "admin" ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                      ) : (
                        "✕"
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button type="button" onClick={() => addRowAfter()} className={s.addBtn}>
            + Add chapter
          </button>

          {rows.length > 0 && pageOffset > 0 && rows[0].endPage > 0 && (
            <p className={s.preview}>
              Preview: Chapter &quot;{rows[0].label}&quot; = PDF pages{" "}
              {rows[0].startPage + pageOffset}–{rows[0].endPage + pageOffset}
            </p>
          )}
        </>
      )}
    </div>
  );
}
