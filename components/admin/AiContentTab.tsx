"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AI_STORED_CONTENT_SECTIONS,
  type AiStoredContentSectionId,
} from "@/lib/ai-stored-content-sections";

interface ContentSource {
  textbookTitle: string | null;
  sourceType: "catalog" | "upload" | "unknown";
  page: number | null;
  chapterOrSection: string | null;
  sessionLabel: string | null;
}

interface ContentResponse {
  section: AiStoredContentSectionId;
  notesType?: "session" | "public" | "all";
  total: number;
  page: number;
  hasMore: boolean;
  items: Record<string, unknown>[];
}

interface CountsResponse {
  counts: Record<AiStoredContentSectionId, number>;
}

type NotesFilter = "all" | "session" | "public";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SourceLine({ source }: { source: ContentSource }) {
  const parts: string[] = [];
  if (source.textbookTitle) parts.push(source.textbookTitle);
  if (source.chapterOrSection && source.chapterOrSection !== source.sessionLabel) {
    parts.push(source.chapterOrSection);
  } else if (source.sessionLabel) {
    parts.push(source.sessionLabel);
  }
  if (source.page != null) parts.push(`p. ${source.page}`);

  if (parts.length === 0) {
    return <span className="text-[10px] text-gray-600 italic">Unknown source</span>;
  }

  return (
    <span className="text-[10px] text-gray-500">
      {parts.join(" · ")}
      {source.sourceType !== "unknown" && (
        <span className="ml-1 text-gray-600">
          ({source.sourceType === "catalog" ? "catalog" : "upload"})
        </span>
      )}
    </span>
  );
}

function ExpandableRow({
  meta,
  source,
  preview,
  full,
  fullLabel = "Full content",
}: {
  meta: React.ReactNode;
  source?: ContentSource;
  preview: string | null;
  full: string;
  fullLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasMore = full && full !== preview;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex flex-col gap-1 px-3 py-2 text-left hover:bg-gray-900/60 transition"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 w-full">
          {meta}
          {hasMore && (
            <span className="text-[10px] text-gray-600 ml-auto">{open ? "▲" : "▼"}</span>
          )}
        </div>
        {source && <SourceLine source={source} />}
        {preview && (
          <p className="text-xs text-gray-400 line-clamp-2">{preview}</p>
        )}
      </button>
      {open && full && (
        <div className="border-t border-gray-800 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
            {fullLabel}
          </p>
          <pre className="text-xs text-gray-300 whitespace-pre-wrap break-words max-h-64 overflow-y-auto rounded bg-gray-900 p-2 font-mono">
            {full}
          </pre>
        </div>
      )}
    </div>
  );
}

function renderItem(section: AiStoredContentSectionId, item: Record<string, unknown>) {
  const source = item.source as ContentSource | undefined;
  const createdAt = formatWhen((item.createdAt as string) ?? null);

  if (section === "notes") {
    const kind = item.kind as string;
    return (
      <ExpandableRow
        key={String(item.id)}
        source={source}
        preview={(item.preview as string) ?? null}
        full={String(item.fullContent ?? "")}
        meta={
          <>
            <span className="text-xs text-gray-500 w-28 flex-shrink-0">{createdAt}</span>
            <span className="text-xs font-medium text-gray-300">
              {kind === "public" ? "Public note" : "Session note"}
            </span>
            {kind === "session" && (
              <span className="text-[10px] text-gray-600">
                {(item.userEmail as string) ?? "—"}
              </span>
            )}
            {kind === "public" && (
              <span className="text-[10px] text-gray-600">
                v{String(item.promptVersion ?? 1)}
              </span>
            )}
          </>
        }
      />
    );
  }

  if (section === "quiz") {
    return (
      <ExpandableRow
        key={String(item.id)}
        source={source}
        preview={(item.preview as string) ?? null}
        full={String(item.questionsJson ?? "")}
        fullLabel="Questions JSON"
        meta={
          <>
            <span className="text-xs text-gray-500 w-28 flex-shrink-0">{createdAt}</span>
            <span className="text-[10px] text-gray-600">{(item.userEmail as string) ?? "—"}</span>
            <span className="text-xs text-gray-500 ml-auto">
              {item.score != null
                ? `${item.score}/${item.totalQuestions ?? item.questionCount}`
                : `${item.questionCount} questions`}
            </span>
          </>
        }
      />
    );
  }

  if (section === "flashcards") {
    return (
      <ExpandableRow
        key={String(item.id)}
        source={source}
        preview={previewText(`${item.front}\n→ ${item.back}`)}
        full={`${item.front}\n\n→ ${item.back}`}
        meta={
          <>
            <span className="text-xs text-gray-500 w-28 flex-shrink-0">{createdAt}</span>
            <span className="text-[10px] text-gray-600">{(item.userEmail as string) ?? "—"}</span>
            <span className="text-xs text-gray-400 truncate max-w-xs">{String(item.front)}</span>
          </>
        }
      />
    );
  }

  if (section === "velocity-games") {
    const growth = (item.growthAreas as string[]) ?? [];
    return (
      <ExpandableRow
        key={String(item.id)}
        source={source}
        preview={
          growth.length > 0
            ? `Growth: ${growth.slice(0, 2).join(", ")}`
            : `${item.questionCount} questions`
        }
        full={String(item.questionsJson ?? "")}
        fullLabel="Questions JSON"
        meta={
          <>
            <span className="text-xs text-gray-500 w-28 flex-shrink-0">{createdAt}</span>
            <span className="text-[10px] text-gray-600">{(item.userEmail as string) ?? "—"}</span>
            <span className="text-xs text-gray-500 ml-auto">
              {item.accuracy != null ? `${item.accuracy}%` : "—"} · {String(item.questionCount)} Q
            </span>
          </>
        }
      />
    );
  }

  if (section === "velocity-bank") {
    return (
      <ExpandableRow
        key={String(item.id)}
        source={source}
        preview={(item.preview as string) ?? null}
        full={String(item.questionJson ?? "")}
        fullLabel="Question JSON"
        meta={
          <>
            <span className="text-xs text-gray-500 w-28 flex-shrink-0">{createdAt}</span>
            <span className="text-xs text-gray-400">{String(item.topic ?? item.type)}</span>
            {Number(item.reportCount) > 0 && (
              <span className="text-[10px] text-amber-500">
                {item.reportCount} report{Number(item.reportCount) !== 1 ? "s" : ""}
              </span>
            )}
          </>
        }
      />
    );
  }

  return null;
}

function previewText(text: string, max = 200): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function AiContentTab() {
  const [counts, setCounts] = useState<Record<AiStoredContentSectionId, number> | null>(
    null
  );
  const [activeSection, setActiveSection] =
    useState<AiStoredContentSectionId>("notes");
  const [notesFilter, setNotesFilter] = useState<NotesFilter>("all");
  const [data, setData] = useState<ContentResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/ai-content?counts=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: CountsResponse) => setCounts(j.counts))
      .catch(() => {});
  }, []);

  const loadSection = useCallback(
    async (section: AiStoredContentSectionId, pageNum: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          section,
          page: String(pageNum),
        });
        if (section === "notes") params.set("notesType", notesFilter);
        const res = await fetch(`/api/admin/ai-content?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: ContentResponse = await res.json();
        setData((prev) => {
          if (append && prev && prev.section === section) {
            return {
              ...json,
              items: [...prev.items, ...json.items],
            };
          }
          return json;
        });
        setPage(pageNum);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [notesFilter]
  );

  useEffect(() => {
    setPage(1);
    loadSection(activeSection, 1, false);
  }, [activeSection, notesFilter, loadSection]);

  const activeLabel =
    AI_STORED_CONTENT_SECTIONS.find((s) => s.id === activeSection)?.label ?? activeSection;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Browse persisted AI-generated content across all users. Videos and ephemeral
        calls (fact-check, grading) are not stored here.
      </p>

      <div className="flex flex-wrap rounded-lg border border-gray-700 p-0.5 text-xs w-fit gap-0.5">
        {AI_STORED_CONTENT_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveSection(s.id)}
            className={`rounded-md px-3 py-1.5 transition whitespace-nowrap ${
              activeSection === s.id
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {s.label}
            {counts != null && (
              <span className="ml-1 text-gray-500">({counts[s.id]})</span>
            )}
          </button>
        ))}
      </div>

      {activeSection === "notes" && (
        <div className="flex rounded-lg border border-gray-800 p-0.5 text-xs w-fit">
          {(
            [
              ["all", "All"],
              ["session", "Session notes"],
              ["public", "Public notes"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setNotesFilter(value)}
              className={`rounded-md px-2.5 py-1 transition whitespace-nowrap ${
                notesFilter === value
                  ? "bg-gray-800 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {loading && !data && (
        <p className="text-sm text-gray-500 animate-pulse py-8 text-center">
          Loading {activeLabel}…
        </p>
      )}
      {error && (
        <p className="text-sm text-red-400 py-8 text-center">
          Could not load content: {error}
        </p>
      )}
      {data && !error && (
        <>
          <p className="text-xs text-gray-500">
            {data.total.toLocaleString()} item{data.total !== 1 ? "s" : ""} in {activeLabel}
          </p>
          {data.items.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">No items in this section.</p>
          ) : (
            <div className="space-y-2">
              {data.items.map((item) => renderItem(activeSection, item))}
            </div>
          )}
          {data.hasMore && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => loadSection(activeSection, page + 1, true)}
              className="w-full rounded-lg border border-gray-700 py-2 text-xs text-gray-400 hover:text-white hover:bg-gray-800 transition disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Show more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
