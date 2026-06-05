"use client";

import { useCallback, useEffect, useState } from "react";

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

function SectionPanel({
  section,
  onLoadMore,
  loadingMore,
}: {
  section: UsageSection;
  onLoadMore: (sectionId: string, nextPage: number) => Promise<void>;
  loadingMore: string | null;
}) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        {section.callCount} call{section.callCount !== 1 ? "s" : ""} ·{" "}
        {section.totalTokens.toLocaleString()} tokens
      </p>
      <div className="space-y-2">
        {section.logs.map((log) => (
          <LogRow key={log.id} log={log} />
        ))}
        {section.hasMore && (
          <button
            type="button"
            disabled={loadingMore === section.id}
            onClick={() => onLoadMore(section.id, section.page + 1)}
            className="w-full rounded-lg border border-gray-700 py-2 text-xs text-gray-400 hover:text-white hover:bg-gray-800 transition disabled:opacity-50"
          >
            {loadingMore === section.id ? "Loading…" : "Show more"}
          </button>
        )}
      </div>
    </div>
  );
}

export function UserAiUsageLog({ userId, lifetimeTokensUsed }: Props) {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setActiveSectionId(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/ai-usage`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!data?.sections.length) return;
    setActiveSectionId((current) =>
      current && data.sections.some((s) => s.id === current)
        ? current
        : data.sections[0].id
    );
  }, [data]);

  const loadMore = async (sectionId: string, nextPage: number) => {
    setLoadingMore(sectionId);
    try {
      const res = await fetch(
        `/api/admin/users/${userId}/ai-usage?section=${encodeURIComponent(sectionId)}&page=${nextPage}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const more: UsageResponse = await res.json();
      const extra = more.sections[0];
      if (!extra) return;
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections.map((s) =>
            s.id === sectionId
              ? {
                  ...s,
                  logs: [...s.logs, ...extra.logs],
                  hasMore: extra.hasMore,
                  page: extra.page,
                }
              : s
          ),
        };
      });
    } finally {
      setLoadingMore(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-500 animate-pulse py-8 text-center">Loading AI usage…</p>;
  }
  if (error) {
    return <p className="text-sm text-red-400 py-8 text-center">Could not load AI usage: {error}</p>;
  }
  if (!data || data.totalCalls === 0) {
    return (
      <p className="text-sm text-gray-500 py-8 text-center">No AI usage recorded for this user yet.</p>
    );
  }

  const activeSection = data.sections.find((s) => s.id === activeSectionId);

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Lifetime counter: {lifetimeTokensUsed.toLocaleString()} tokens · {data.totalCalls} logged call
        {data.totalCalls !== 1 ? "s" : ""} ({data.totalTokens.toLocaleString()} tokens in log)
      </p>
      <div className="flex flex-wrap rounded-lg border border-gray-700 p-0.5 text-xs w-fit gap-0.5">
        {data.sections.map((section) => (
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
      {activeSection && (
        <SectionPanel
          section={activeSection}
          onLoadMore={loadMore}
          loadingMore={loadingMore}
        />
      )}
    </div>
  );
}
