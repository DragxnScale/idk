"use client";

import { useCallback, useEffect, useState } from "react";
import { PaginationBar } from "@/components/PaginationBar";
import {
  AI_STORED_CONTENT_SECTIONS,
  DEFAULT_CONTENT_PAGE_SIZE,
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
  notesType?: "session" | "public" | "document" | "all";
  total: number;
  page: number;
  hasMore: boolean;
  items: Record<string, unknown>[];
}

interface CountsResponse {
  counts: Record<AiStoredContentSectionId, number>;
}

type NotesFilter = "all" | "session" | "public" | "document";

type EditState = {
  section: AiStoredContentSectionId;
  item: Record<string, unknown>;
} | null;

type DeleteState = {
  section: AiStoredContentSectionId;
  id: string;
  label: string;
  notesKind?: "public" | "document";
} | null;

function deleteConfirmCopy(state: DeleteState): { title: string; body: string } {
  if (!state) return { title: "Delete?", body: "" };
  switch (state.section) {
    case "notes":
      return {
        title: "Delete cached notes?",
        body: "Session copies are kept. The next user on this page will regenerate from AI.",
      };
    case "quiz":
      return {
        title: "Remove quiz question?",
        body: "Removes this question from the session quiz. If it was the last question, the whole quiz row is deleted.",
      };
    case "flashcards":
      return {
        title: "Delete flashcard?",
        body: "Removes this card from the review queue. Upload cache cards will not be reused for that page overlap.",
      };
    case "velocity-games":
      return {
        title: "Delete velocity game?",
        body: "Permanently removes this session's velocity game record.",
      };
    case "velocity-bank":
      return {
        title: "Delete bank question?",
        body: "Future velocity games will not draw this question from the shared pool.",
      };
    default:
      return { title: "Delete item?", body: "This cannot be undone." };
  }
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

function previewText(text: string, max = 200): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
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
  rowKey,
  meta,
  source,
  preview,
  full,
  fullLabel = "Full content",
  editable,
  deletable,
  onDelete,
  onEdit,
}: {
  rowKey: string;
  meta: React.ReactNode;
  source?: ContentSource;
  preview: string | null;
  full: string;
  fullLabel?: string;
  editable?: boolean;
  deletable?: boolean;
  onDelete?: () => void;
  onEdit?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hasMore = full && full !== preview;

  return (
    <div
      className="rounded-lg border border-gray-800 bg-gray-950 overflow-hidden"
      onContextMenu={
        editable && onEdit
          ? (e) => {
              e.preventDefault();
              onEdit();
            }
          : undefined
      }
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 min-w-0 flex flex-col gap-1 px-3 py-2 text-left hover:bg-gray-900/60 transition"
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
        {deletable && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="flex-shrink-0 px-3 text-gray-500 hover:text-red-400 hover:bg-gray-900/60 text-lg leading-none transition border-l border-gray-800"
            title="Delete"
            aria-label="Delete"
          >
            ×
          </button>
        )}
      </div>
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

function formatQuizExpand(item: Record<string, unknown>): string {
  const options = (item.options as string[]) ?? [];
  const correct = Number(item.correctIndex ?? 0);
  const lines = [
    String(item.question ?? ""),
    "",
    ...options.map((o, i) => `${i === correct ? "→ " : "  "}${String.fromCharCode(65 + i)}. ${o}`),
    "",
    `Explanation: ${String(item.explanation ?? "")}`,
  ];
  if (item.pageIndex != null) {
    lines.push(`Page: ${String(item.pageIndex)}`);
  }
  return lines.join("\n");
}

function noteKindLabel(kind: string): string {
  if (kind === "public") return "Public note";
  if (kind === "document") return "Document cache";
  return "Session note";
}

function renderItem(
  section: AiStoredContentSectionId,
  item: Record<string, unknown>,
  onDelete: (state: DeleteState) => void,
  onEdit: (section: AiStoredContentSectionId, item: Record<string, unknown>) => void
) {
  const source = item.source as ContentSource | undefined;
  const createdAt = formatWhen((item.createdAt as string) ?? null);
  const editable = Boolean(item.editable);
  const deletable = Boolean(item.deletable);
  const rowKey = String(item.id);

  if (section === "notes") {
    const kind = item.kind as string;
    const title = source?.textbookTitle ?? "this document";
    const page = source?.page;
    return (
      <ExpandableRow
        key={rowKey}
        rowKey={rowKey}
        source={source}
        preview={(item.preview as string) ?? null}
        full={String(item.fullContent ?? "")}
        editable={editable}
        deletable={deletable}
        onEdit={editable ? () => onEdit(section, item) : undefined}
        onDelete={
          deletable
            ? () =>
                onDelete({
                  section: "notes",
                  id: String(item.id),
                  notesKind: kind === "document" ? "document" : "public",
                  label: `${title}${page != null ? ` p. ${page}` : ""}`,
                })
            : undefined
        }
        meta={
          <>
            <span className="text-xs text-gray-500 w-28 flex-shrink-0">{createdAt}</span>
            <span className="text-xs font-medium text-gray-300">
              {noteKindLabel(kind)}
            </span>
            {kind === "session" && (
              <span className="text-[10px] text-gray-600">
                {(item.userEmail as string) ?? "—"}
              </span>
            )}
            {(kind === "public" || kind === "document") && (
              <span className="text-[10px] text-gray-600">
                v{String(item.promptVersion ?? 1)}
              </span>
            )}
            {kind === "document" && (
              <span className="text-[10px] text-gray-600">
                {(item.userEmail as string) ?? "—"}
              </span>
            )}
          </>
        }
      />
    );
  }

  if (section === "quiz") {
    const qPreview = (item.preview as string) ?? String(item.question ?? "Question");
    return (
      <ExpandableRow
        key={rowKey}
        rowKey={rowKey}
        source={source}
        preview={(item.preview as string) ?? null}
        full={formatQuizExpand(item)}
        fullLabel="Question details"
        editable={editable}
        deletable={deletable}
        onEdit={editable ? () => onEdit(section, item) : undefined}
        onDelete={
          deletable
            ? () =>
                onDelete({
                  section: "quiz",
                  id: String(item.id),
                  label: qPreview.slice(0, 80),
                })
            : undefined
        }
        meta={
          <>
            <span className="text-xs text-gray-500 w-28 flex-shrink-0">{createdAt}</span>
            <span className="text-[10px] text-gray-600">{(item.userEmail as string) ?? "—"}</span>
            {item.pageIndex != null && (
              <span className="text-[10px] text-gray-500">p. {String(item.pageIndex)}</span>
            )}
          </>
        }
      />
    );
  }

  if (section === "flashcards") {
    return (
      <ExpandableRow
        key={rowKey}
        rowKey={rowKey}
        source={source}
        preview={previewText(`${item.front}\n→ ${item.back}`)}
        full={`${item.front}\n\n→ ${item.back}`}
        editable={editable}
        deletable={deletable}
        onEdit={editable ? () => onEdit(section, item) : undefined}
        onDelete={
          deletable
            ? () =>
                onDelete({
                  section: "flashcards",
                  id: String(item.id),
                  label: String(item.front ?? "Flashcard"),
                })
            : undefined
        }
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
        key={rowKey}
        rowKey={rowKey}
        source={source}
        preview={
          growth.length > 0
            ? `Growth: ${growth.slice(0, 2).join(", ")}`
            : `${item.questionCount} questions`
        }
        full={String(item.questionsJson ?? "")}
        fullLabel="Questions JSON"
        deletable={deletable}
        onDelete={
          deletable
            ? () =>
                onDelete({
                  section: "velocity-games",
                  id: String(item.id),
                  label: `${(item.userEmail as string) ?? "user"} · ${String(item.questionCount)} Q`,
                })
            : undefined
        }
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
    const bankLabel =
      (item.preview as string) ?? String(item.topic ?? item.type ?? "Bank question");
    return (
      <ExpandableRow
        key={rowKey}
        rowKey={rowKey}
        source={source}
        preview={(item.preview as string) ?? null}
        full={String(item.questionJson ?? "")}
        fullLabel="Question JSON"
        editable={editable}
        deletable={deletable}
        onEdit={editable ? () => onEdit(section, item) : undefined}
        onDelete={
          deletable
            ? () =>
                onDelete({
                  section: "velocity-bank",
                  id: String(item.id),
                  label: bankLabel.slice(0, 80),
                })
            : undefined
        }
        meta={
          <>
            <span className="text-xs text-gray-500 w-28 flex-shrink-0">{createdAt}</span>
            <span className="text-xs text-gray-400">{String(item.topic ?? item.type)}</span>
            {Number(item.reportCount) > 0 && (
              <span className="text-[10px] text-amber-500">
                {Number(item.reportCount)} report{Number(item.reportCount) !== 1 ? "s" : ""}
              </span>
            )}
          </>
        }
      />
    );
  }

  return null;
}

function EditModal({
  edit,
  saving,
  onSave,
  onClose,
}: {
  edit: EditState;
  saving: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!edit) return;
    const { section, item } = edit;
    if (section === "notes") {
      setDraft({ content: String(item.fullContent ?? "") });
    } else if (section === "flashcards") {
      setDraft({ front: String(item.front ?? ""), back: String(item.back ?? "") });
    } else if (section === "quiz") {
      setDraft({
        question: String(item.question ?? ""),
        options: [...((item.options as string[]) ?? ["", "", "", ""])],
        correctIndex: Number(item.correctIndex ?? 0),
        explanation: String(item.explanation ?? ""),
      });
    } else if (section === "velocity-bank") {
      setDraft({ questionJson: String(item.questionJson ?? "{}") });
    }
  }, [edit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!edit) return null;

  const { section } = edit;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-gray-900 border border-gray-700 p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
        <h2 className="text-base font-semibold mb-4">Edit {section} item</h2>

        {section === "notes" && (
          <textarea
            value={String(draft.content ?? "")}
            onChange={(e) => setDraft({ content: e.target.value })}
            rows={12}
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 font-mono"
          />
        )}

        {section === "flashcards" && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Front</label>
              <textarea
                value={String(draft.front ?? "")}
                onChange={(e) => setDraft((d) => ({ ...d, front: e.target.value }))}
                rows={3}
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Back</label>
              <textarea
                value={String(draft.back ?? "")}
                onChange={(e) => setDraft((d) => ({ ...d, back: e.target.value }))}
                rows={5}
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200"
              />
            </div>
          </div>
        )}

        {section === "quiz" && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Question</label>
              <textarea
                value={String(draft.question ?? "")}
                onChange={(e) => setDraft((d) => ({ ...d, question: e.target.value }))}
                rows={3}
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200"
              />
            </div>
            {((draft.options as string[]) ?? []).map((opt, i) => (
              <div key={i}>
                <label className="text-xs text-gray-500 block mb-1">
                  Option {String.fromCharCode(65 + i)}
                </label>
                <input
                  value={opt}
                  onChange={(e) => {
                    const options = [...((draft.options as string[]) ?? [])];
                    options[i] = e.target.value;
                    setDraft((d) => ({ ...d, options }));
                  }}
                  className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200"
                />
              </div>
            ))}
            <div>
              <label className="text-xs text-gray-500 block mb-1">Correct answer</label>
              <select
                value={Number(draft.correctIndex ?? 0)}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, correctIndex: Number(e.target.value) }))
                }
                className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200"
              >
                {[0, 1, 2, 3].map((i) => (
                  <option key={i} value={i}>
                    {String.fromCharCode(65 + i)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Explanation</label>
              <textarea
                value={String(draft.explanation ?? "")}
                onChange={(e) => setDraft((d) => ({ ...d, explanation: e.target.value }))}
                rows={3}
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200"
              />
            </div>
          </div>
        )}

        {section === "velocity-bank" && (
          <textarea
            value={String(draft.questionJson ?? "")}
            onChange={(e) => setDraft({ questionJson: e.target.value })}
            rows={14}
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 font-mono"
          />
        )}

        <div className="flex gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave(draft)}
            className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
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
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DeleteState>(null);
  const [deleting, setDeleting] = useState(false);

  const refreshCounts = useCallback(() => {
    fetch("/api/admin/ai-content?counts=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: CountsResponse) => setCounts(j.counts))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  const loadSection = useCallback(
    async (section: AiStoredContentSectionId, pageNum: number) => {
      setLoading(true);
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
        setData(json);
        setPage(pageNum);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [notesFilter]
  );

  useEffect(() => {
    setPage(1);
    void loadSection(activeSection, 1);
  }, [activeSection, notesFilter, loadSection]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const params = new URLSearchParams({
        section: confirmDelete.section,
        id: confirmDelete.id,
      });
      if (confirmDelete.section === "notes" && confirmDelete.notesKind) {
        params.set("kind", confirmDelete.notesKind);
      }
      const res = await fetch(`/api/admin/ai-content/item?${params}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.filter((i) => String(i.id) !== confirmDelete.id),
              total: Math.max(0, prev.total - 1),
            }
          : prev
      );
      refreshCounts();
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveEdit = async (patch: Record<string, unknown>) => {
    if (!edit) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        section: edit.section,
        id: String(edit.item.id),
        patch,
      };
      if (edit.section === "notes") {
        body.kind = edit.item.kind;
      }
      const res = await fetch("/api/admin/ai-content/item", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();

      setData((prev) => {
        if (!prev) return prev;
        const items = prev.items.map((item) => {
          if (String(item.id) !== String(edit.item.id)) return item;
          if (edit.section === "notes") {
            const content = String(result.content ?? patch.content ?? "");
            return { ...item, fullContent: content, preview: previewText(content) };
          }
          if (edit.section === "flashcards") {
            return {
              ...item,
              front: result.front ?? patch.front,
              back: result.back ?? patch.back,
            };
          }
          if (edit.section === "quiz") {
            const q = result.question ?? patch;
            return {
              ...item,
              ...q,
              preview: previewText(String(q.question ?? "")),
            };
          }
          if (edit.section === "velocity-bank") {
            const qj = String(result.questionJson ?? patch.questionJson ?? "");
            let preview: string | null = null;
            try {
              const q = JSON.parse(qj) as { question?: string; prompt?: string };
              preview = q.question ?? q.prompt ?? null;
            } catch {
              /* ignore */
            }
            return {
              ...item,
              questionJson: qj,
              preview: preview ? previewText(preview) : null,
            };
          }
          return item;
        });
        return { ...prev, items };
      });
      setEdit(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const activeLabel =
    AI_STORED_CONTENT_SECTIONS.find((s) => s.id === activeSection)?.label ?? activeSection;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Browse persisted AI-generated content across all users. Videos and ephemeral
        calls (fact-check, grading) are not stored here. Right-click a row to edit.
        × deletes or invalidates cache rows (notes cache keeps session copies).
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
        <div className="space-y-2">
          <div className="flex rounded-lg border border-gray-800 p-0.5 text-xs w-fit">
            {(
              [
                ["all", "All"],
                ["session", "Session notes"],
                ["public", "Public notes"],
                ["document", "Document cache"],
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
          {notesFilter === "session" && (
            <p className="text-[10px] text-gray-600">
              Session notes cannot be deleted here. Use Public notes or Document cache to remove
              shared caches (× on each row).
            </p>
          )}
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
      {data && !error && (() => {
        const totalPages = Math.max(1, Math.ceil(data.total / DEFAULT_CONTENT_PAGE_SIZE));
        return (
          <>
            <p className="text-xs text-gray-500">
              {data.total.toLocaleString()} item{data.total !== 1 ? "s" : ""} in {activeLabel}
              {totalPages > 1 && (
                <span className="text-gray-600">
                  {" "}
                  · page {page} of {totalPages}
                </span>
              )}
            </p>
            {data.items.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">No items in this section.</p>
            ) : (
              <div className={`space-y-2 ${loading ? "opacity-60 pointer-events-none" : ""}`}>
                {data.items.map((item) =>
                  renderItem(
                    activeSection,
                    item,
                    setConfirmDelete,
                    (section, row) => setEdit({ section, item: row })
                  )
                )}
              </div>
            )}
            <PaginationBar
              page={page}
              totalPages={totalPages}
              loading={loading}
              onPrev={() => void loadSection(activeSection, page - 1)}
              onNext={() => void loadSection(activeSection, page + 1)}
            />
          </>
        );
      })()}

      <EditModal
        edit={edit}
        saving={saving}
        onSave={handleSaveEdit}
        onClose={() => setEdit(null)}
      />

      {confirmDelete && (() => {
        const copy = deleteConfirmCopy(confirmDelete);
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-700 p-6 shadow-2xl">
            <h2 className="text-base font-semibold mb-1">{copy.title}</h2>
            <p className="text-sm text-gray-400 mb-1">
              <span className="text-white font-medium">{confirmDelete.label}</span>
            </p>
            <p className="text-sm text-gray-500 mb-5">{copy.body}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="flex-1 rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium hover:bg-red-700 transition disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
