"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  bookRangesToTocRows,
  createNewTocRowAfter,
  finalPdfRanges,
  parseTocRangesJson,
  tocRowsToBookRanges,
  type TocRow,
} from "@/lib/toc-editor-utils";

export type TocEditorVariant = "admin" | "study";

type TopTab = "visual" | "json" | "final";
type FinalSubTab = "visual" | "json";

const VARIANT_STYLES = {
  admin: {
    offsetLabel: "block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide",
    offsetInput:
      "w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono focus:outline-none focus:border-gray-500",
    offsetHint: "text-xs text-gray-600 mt-1",
    offsetHintStrong: "text-gray-400",
    tabBar: "flex gap-1 rounded-lg border border-gray-800 bg-gray-900/50 p-1",
    tabActive: "rounded-md bg-gray-700 px-3 py-1.5 text-xs font-medium text-white",
    tabIdle:
      "rounded-md px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-200 transition",
    subTabBar: "flex gap-1 rounded-lg border border-gray-800 bg-gray-950/50 p-0.5",
    subTabActive: "rounded-md bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-200",
    subTabIdle:
      "rounded-md px-2.5 py-1 text-xs font-medium text-gray-500 hover:text-gray-300 transition",
    sectionHint: "text-xs text-gray-600",
    sectionHintStrong: "text-gray-400",
    jsonTextarea:
      "w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-gray-500 resize-y",
    jsonHint: "text-xs text-gray-600",
    jsonHintStrong: "text-gray-400",
    applyJsonBtn:
      "rounded-lg bg-white text-black px-4 py-1.5 text-xs font-medium hover:bg-gray-200 transition",
    tableWrap: "rounded-xl border border-gray-800 overflow-x-auto",
    tableHead:
      "grid grid-cols-[1fr_90px_90px_36px] gap-2 px-3 py-2 bg-gray-800/50 text-xs text-gray-500 uppercase tracking-wide min-w-[350px]",
    tableRow:
      "grid grid-cols-[1fr_90px_90px_36px] gap-2 px-3 py-1.5 items-center min-w-[350px]",
    tableRowReadonly:
      "grid grid-cols-[1fr_90px_90px] gap-2 px-3 py-1.5 items-center min-w-[300px] text-sm",
    tableDivide: "divide-y divide-gray-800",
    cellInput:
      "rounded border border-gray-700 bg-gray-950 px-2 py-1 text-sm focus:outline-none focus:border-gray-500",
    cellMono:
      "rounded border border-gray-700 bg-gray-950 px-2 py-1 text-sm font-mono focus:outline-none focus:border-gray-500",
    cellReadonly: "font-mono text-gray-300",
    removeBtn:
      "rounded p-1 text-gray-600 hover:text-red-400 hover:bg-gray-800 transition",
    addBtn:
      "w-full rounded-lg border border-dashed border-gray-700 px-4 py-2 text-xs text-gray-400 hover:border-gray-500 hover:text-gray-300 transition",
    jsonError: "text-xs text-red-400",
    finalPre:
      "w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm font-mono text-gray-300 overflow-x-auto",
  },
  study: {
    offsetLabel: "text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1",
    offsetInput:
      "w-28 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800",
    offsetHint: "text-xs text-gray-500 dark:text-gray-500 mt-1",
    offsetHintStrong: "text-gray-600 dark:text-gray-400",
    tabBar:
      "flex gap-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/50 p-1",
    tabActive:
      "rounded-md bg-white dark:bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-900 dark:text-white shadow-sm",
    tabIdle:
      "rounded-md px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition",
    subTabBar:
      "flex gap-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-0.5",
    subTabActive:
      "rounded-md bg-white dark:bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-900 dark:text-gray-200 shadow-sm",
    subTabIdle:
      "rounded-md px-2.5 py-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition",
    sectionHint: "text-xs text-gray-500 dark:text-gray-500",
    sectionHintStrong: "text-gray-600 dark:text-gray-400",
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
    tableRowReadonly:
      "grid grid-cols-[1fr_90px_90px] gap-2 px-3 py-1.5 items-center min-w-[300px] text-sm dark:text-gray-200",
    tableDivide: "divide-y divide-gray-200 dark:divide-gray-700",
    cellInput:
      "rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 focus:outline-none focus:border-gray-500",
    cellMono:
      "rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm font-mono dark:border-gray-600 dark:bg-gray-800 focus:outline-none focus:border-gray-500",
    cellReadonly: "font-mono text-gray-700 dark:text-gray-300",
    removeBtn: "text-red-400 hover:text-red-600 text-sm px-1",
    addBtn:
      "w-full rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-4 py-2 text-xs text-gray-500 hover:border-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition",
    jsonError: "text-xs text-red-500",
    finalPre:
      "w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm font-mono text-gray-800 dark:text-gray-200 overflow-x-auto",
  },
} as const;

function TabButton({
  active,
  onClick,
  children,
  activeClass,
  idleClass,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  activeClass: string;
  idleClass: string;
}) {
  return (
    <button type="button" onClick={onClick} className={active ? activeClass : idleClass}>
      {children}
    </button>
  );
}

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
  const [topTab, setTopTab] = useState<TopTab>("visual");
  const [finalSubTab, setFinalSubTab] = useState<FinalSubTab>("visual");
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const endPageRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  const finalRanges = useMemo(
    () => finalPdfRanges(rows, pageOffset),
    [rows, pageOffset]
  );

  const finalRows = useMemo(
    () =>
      Object.entries(finalRanges)
        .sort(([, a], [, b]) => a[0] - b[0])
        .map(([label, [start, end]]) => ({ label, startPage: start, endPage: end })),
    [finalRanges]
  );

  useEffect(() => {
    if (focusIdx !== null) {
      const el = endPageRefs.current.get(focusIdx);
      if (el) el.focus();
      setFocusIdx(null);
    }
  }, [focusIdx, rows.length]);

  function switchToJsonTab() {
    setJsonDraft(JSON.stringify(tocRowsToBookRanges(rows), null, 2));
    setJsonError(null);
    setTopTab("json");
  }

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

  function applyBookJson() {
    try {
      const parsed = parseTocRangesJson(jsonDraft);
      onChange(bookRangesToTocRows(parsed));
      setJsonError(null);
      setTopTab("visual");
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  function renderEditableGrid() {
    return (
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
      </>
    );
  }

  function renderReadonlyGrid(items: { label: string; startPage: number; endPage: number }[]) {
    if (items.length === 0) {
      return (
        <p className={s.sectionHint}>
          Complete at least one chapter with valid start/end pages in the Visual editor.
        </p>
      );
    }
    return (
      <div className={s.tableWrap}>
        <div className={`${s.tableHead} grid-cols-[1fr_90px_90px] min-w-[300px]`}>
          <span>Chapter</span>
          <span>Start pg</span>
          <span>End pg</span>
        </div>
        <div className={s.tableDivide}>
          {items.map((row) => (
            <div key={row.label} className={s.tableRowReadonly}>
              <span>{row.label}</span>
              <span className={s.cellReadonly}>{row.startPage}</span>
              <span className={s.cellReadonly}>{row.endPage}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-4">
        <div className={variant === "study" ? undefined : "flex-1"}>
          <label className={s.offsetLabel}>Page offset</label>
          <input
            type="text"
            inputMode="numeric"
            value={pageOffset || ""}
            onChange={(e) => onPageOffsetChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
            className={s.offsetInput}
            placeholder="0"
          />
          <p className={s.offsetHint}>
            If book page 1 is on PDF page 15, enter{" "}
            <strong className={s.offsetHintStrong}>14</strong>. The{" "}
            <strong className={s.offsetHintStrong}>Final</strong> tab shows PDF pages after adding
            this offset (book + offset).
          </p>
        </div>
      </div>

      <div className={s.tabBar}>
        <TabButton
          active={topTab === "visual"}
          onClick={() => setTopTab("visual")}
          activeClass={s.tabActive}
          idleClass={s.tabIdle}
        >
          Visual editor
        </TabButton>
        <TabButton
          active={topTab === "json"}
          onClick={switchToJsonTab}
          activeClass={s.tabActive}
          idleClass={s.tabIdle}
        >
          JSON
        </TabButton>
        <TabButton
          active={topTab === "final"}
          onClick={() => setTopTab("final")}
          activeClass={s.tabActive}
          idleClass={s.tabIdle}
        >
          Final
        </TabButton>
      </div>

      {topTab === "visual" && (
        <div className="space-y-2">
          <p className={s.sectionHint}>
            <strong className={s.sectionHintStrong}>Book pages</strong> — offset is applied in the
            Final tab.
          </p>
          {renderEditableGrid()}
        </div>
      )}

      {topTab === "json" && (
        <div className="space-y-2">
          <p className={s.sectionHint}>
            <strong className={s.sectionHintStrong}>Book pages</strong> as JSON (same as Visual
            editor).
          </p>
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
            Format: <strong className={s.jsonHintStrong}>{`{"1": [start, end], …}`}</strong> using{" "}
            <em>book</em> page numbers.
          </p>
          <button type="button" onClick={applyBookJson} className={s.applyJsonBtn}>
            Apply JSON
          </button>
        </div>
      )}

      {topTab === "final" && (
        <div className="space-y-3">
          <p className={s.sectionHint}>
            <strong className={s.sectionHintStrong}>Read-only</strong> — saved PDF page ranges
            (book + offset). Switch to Visual editor or JSON to edit.
          </p>
          <div className={s.subTabBar}>
            <TabButton
              active={finalSubTab === "visual"}
              onClick={() => setFinalSubTab("visual")}
              activeClass={s.subTabActive}
              idleClass={s.subTabIdle}
            >
              Visual
            </TabButton>
            <TabButton
              active={finalSubTab === "json"}
              onClick={() => setFinalSubTab("json")}
              activeClass={s.subTabActive}
              idleClass={s.subTabIdle}
            >
              JSON
            </TabButton>
          </div>
          {finalSubTab === "visual"
            ? renderReadonlyGrid(finalRows)
            : (
              <pre className={s.finalPre}>
                {Object.keys(finalRanges).length > 0
                  ? JSON.stringify(finalRanges, null, 2)
                  : "{}"}
              </pre>
            )}
        </div>
      )}
    </div>
  );
}
