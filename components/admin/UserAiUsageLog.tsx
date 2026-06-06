"use client";

import { useCallback, useEffect, useState } from "react";
import { PaginationBar } from "@/components/PaginationBar";

const USAGE_PAGE_SIZE = 10;

interface UsageLogRow {
  id: string;
  route: string;
  subRouteLabel: string;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  createdAt: string | null;
  inputText: string | null;
  outputText: string | null;
}

interface UsageSection {
  id: string;
  label: string;
  totalTokens: number;
  callCount: number;
  logs: UsageLogRow[];
  hasMore: boolean;
  page: number;
  perPage?: number;
}

interface UsageResponse {
  totalCalls: number;
  totalTokens: number;
  sections: UsageSection[];
}

interface Props {
  userId: string;
  lifetimeTokensUsed: number;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function LogRow({ log }: { log: UsageLogRow }) {
  const [open, setOpen] = useState(false);
  const hasText = !!(log.inputText || log.outputText);

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-gray-900/60 transition"
      >
        <span className="text-xs text-gray-500 w-28 flex-shrink-0">{formatWhen(log.createdAt)}</span>
        <span className="text-xs font-medium text-gray-300">{log.subRouteLabel}</span>
        <span className="text-[10px] text-gray-600 font-mono">{log.route}</span>
        <span className="text-xs text-gray-500 ml-auto font-mono">
          {log.promptTokens.toLocaleString()} + {log.completionTokens.toLocaleString()} ={" "}
          {log.totalTokens.toLocaleString()}
        </span>
        {hasText && (
          <span className="text-[10px] text-gray-600">{open ? "▲" : "▼"}</span>
        )}
      </button>
      {open && (
        <div className="border-t border-gray-800 px-3 py-2 space-y-3">
          {log.inputText || log.outputText ? (
            <>
              {log.inputText && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Input</p>
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words max-h-64 overflow-y-auto rounded bg-gray-900 p-2 font-mono">
                    {log.inputText}
                  </pre>
                </div>
              )}
              {log.outputText && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Output</p>
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words max-h-64 overflow-y-auto rounded bg-gray-900 p-2 font-mono">
                    {log.outputText}
                  </pre>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-gray-500 italic">
              No input/output recorded (predates text logging).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function UserAiUsageLog({ userId, lifetimeTokensUsed }: Props) {
  const [sections, setSections] = useState<UsageSection[]>([]);
  const [summary, setSummary] = useState<{ totalCalls: number; totalTokens: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setActiveSectionId(null);
    setPage(1);
    try {
      const res = await fetch(`/api/admin/users/${userId}/ai-usage`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: UsageResponse = await res.json();
      setSummary({ totalCalls: data.totalCalls, totalTokens: data.totalTokens });
      setSections(data.sections);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const loadSectionPage = useCallback(
    async (sectionId: string, pageNum: number) => {
      setLoadingPage(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/admin/users/${userId}/ai-usage?section=${encodeURIComponent(sectionId)}&page=${pageNum}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: UsageResponse = await res.json();
        const updated = data.sections[0];
        if (!updated) return;
        setSections((prev) =>
          prev.map((s) => (s.id === sectionId ? { ...s, ...updated, page: pageNum } : s))
        );
        setPage(pageNum);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoadingPage(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (!sections.length) return;
    setActiveSectionId((current) =>
      current && sections.some((s) => s.id === current) ? current : sections[0].id
    );
  }, [sections]);

  useEffect(() => {
    if (!activeSectionId) return;
    setPage(1);
    void loadSectionPage(activeSectionId, 1);
  }, [activeSectionId, loadSectionPage]);

  if (loading) {
    return <p className="text-sm text-gray-500 animate-pulse py-8 text-center">Loading AI usage…</p>;
  }
  if (error && !sections.length) {
    return <p className="text-sm text-red-400 py-8 text-center">Could not load AI usage: {error}</p>;
  }
  if (!summary || summary.totalCalls === 0) {
    return (
      <p className="text-sm text-gray-500 py-8 text-center">No AI usage recorded for this user yet.</p>
    );
  }

  const activeSection = sections.find((s) => s.id === activeSectionId);
  const perPage = activeSection?.perPage ?? USAGE_PAGE_SIZE;
  const totalPages = activeSection
    ? Math.max(1, Math.ceil(activeSection.callCount / perPage))
    : 1;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Lifetime counter: {lifetimeTokensUsed.toLocaleString()} tokens · {summary.totalCalls} logged call
        {summary.totalCalls !== 1 ? "s" : ""} ({summary.totalTokens.toLocaleString()} tokens in log)
      </p>
      <div className="flex flex-wrap rounded-lg border border-gray-700 p-0.5 text-xs w-fit gap-0.5">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => setActiveSectionId(section.id)}
            className={`rounded-md px-3 py-1.5 transition whitespace-nowrap ${
              activeSectionId === section.id
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {section.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="text-sm text-red-400 text-center">Could not load page: {error}</p>
      )}
      {activeSection && (
        <div>
          <p className="text-xs text-gray-500 mb-3">
            {activeSection.callCount} call{activeSection.callCount !== 1 ? "s" : ""} ·{" "}
            {activeSection.totalTokens.toLocaleString()} tokens
            {totalPages > 1 && (
              <span className="text-gray-600">
                {" "}
                · page {page} of {totalPages}
              </span>
            )}
          </p>
          <div className={`space-y-2 ${loadingPage ? "opacity-60 pointer-events-none" : ""}`}>
            {activeSection.logs.map((log) => (
              <LogRow key={log.id} log={log} />
            ))}
          </div>
          <PaginationBar
            page={page}
            totalPages={totalPages}
            loading={loadingPage}
            onPrev={() => void loadSectionPage(activeSection.id, page - 1)}
            onNext={() => void loadSectionPage(activeSection.id, page + 1)}
          />
        </div>
      )}
    </div>
  );
}
