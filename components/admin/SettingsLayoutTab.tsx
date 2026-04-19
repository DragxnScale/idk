"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type CardConfig,
  type SettingsLayoutConfig,
  type FontFamily,
  type TitleSize,
  type TextSize,
  type CardSpan,
  DEFAULT_CONFIG,
  CARD_LABELS,
} from "@/lib/types/settings-layout";

// ── Draggable card tile ──────────────────────────────────────────────────────

function SortableCardTile({
  card,
  selected,
  onClick,
}: {
  card: CardConfig;
  selected: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    gridColumn: card.span === 2 ? "1 / -1" : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      className={`group relative rounded-xl border-2 cursor-pointer transition-all select-none
        ${selected
          ? "border-blue-500 bg-blue-950/40 shadow-lg shadow-blue-900/30"
          : "border-gray-700 bg-gray-800/60 hover:border-gray-500"
        }
        ${!card.visible ? "opacity-40" : ""}
      `}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="absolute top-2 right-2 p-1 rounded text-gray-500 hover:text-gray-300 cursor-grab active:cursor-grabbing"
        title="Drag to reorder"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5" cy="4" r="1.5"/><circle cx="11" cy="4" r="1.5"/>
          <circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/>
          <circle cx="5" cy="12" r="1.5"/><circle cx="11" cy="12" r="1.5"/>
        </svg>
      </button>

      <div className="p-3 pr-8">
        <div className="flex items-center gap-2 mb-1">
          {/* Span badge */}
          <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded
            ${card.span === 2 ? "bg-indigo-600/60 text-indigo-300" : "bg-gray-700 text-gray-400"}`}>
            {card.span === 2 ? "Full" : "Half"}
          </span>
          {!card.visible && (
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-900/50 text-red-400">
              Hidden
            </span>
          )}
        </div>
        <p className="text-sm font-semibold text-gray-100 leading-tight">
          {card.titleText ?? CARD_LABELS[card.id] ?? card.id}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          font: {card.fontFamily} · title: {card.titleSize} · body: {card.descSize}
        </p>
      </div>
    </div>
  );
}

// Overlay ghost while dragging
function CardGhost({ card }: { card: CardConfig }) {
  return (
    <div className="rounded-xl border-2 border-blue-400 bg-blue-900/60 p-3 shadow-2xl w-48 rotate-2">
      <p className="text-sm font-semibold text-blue-200">
        {card.titleText ?? CARD_LABELS[card.id] ?? card.id}
      </p>
    </div>
  );
}

// ── Properties panel ─────────────────────────────────────────────────────────

function PropertiesPanel({
  card,
  onChange,
}: {
  card: CardConfig;
  onChange: (updated: Partial<CardConfig>) => void;
}) {
  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-gray-200">
        {CARD_LABELS[card.id] ?? card.id}
      </h3>

      {/* Visibility */}
      <label className="flex items-center justify-between">
        <span className="text-xs text-gray-400">Visible</span>
        <button
          type="button"
          onClick={() => onChange({ visible: !card.visible })}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            card.visible ? "bg-blue-600" : "bg-gray-600"
          }`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            card.visible ? "translate-x-4" : "translate-x-1"
          }`} />
        </button>
      </label>

      {/* Span */}
      <div>
        <p className="text-xs text-gray-400 mb-1.5">Card width</p>
        <div className="grid grid-cols-2 gap-1.5">
          {([1, 2] as CardSpan[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ span: s })}
              className={`rounded-lg py-1.5 text-xs font-medium border transition ${
                card.span === s
                  ? "border-blue-500 bg-blue-600/30 text-blue-300"
                  : "border-gray-600 text-gray-400 hover:border-gray-500"
              }`}
            >
              {s === 1 ? "Half (1 col)" : "Full (2 col)"}
            </button>
          ))}
        </div>
      </div>

      {/* Title text */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Heading text</label>
        <input
          type="text"
          value={card.titleText ?? ""}
          onChange={(e) => onChange({ titleText: e.target.value || null })}
          placeholder={CARD_LABELS[card.id] ?? "(default)"}
          className="w-full rounded-lg border border-gray-600 bg-gray-700 px-2.5 py-1.5 text-sm text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Title size */}
      <div>
        <p className="text-xs text-gray-400 mb-1.5">Heading size</p>
        <div className="flex gap-1 flex-wrap">
          {(["xs", "sm", "base", "lg", "xl"] as TitleSize[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ titleSize: s })}
              className={`rounded-md px-2.5 py-1 text-xs font-medium border transition ${
                card.titleSize === s
                  ? "border-blue-500 bg-blue-600/30 text-blue-300"
                  : "border-gray-600 text-gray-400 hover:border-gray-500"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Desc text */}
      <div>
        <label className="block text-xs text-gray-400 mb-1">Description text</label>
        <textarea
          rows={3}
          value={card.descText ?? ""}
          onChange={(e) => onChange({ descText: e.target.value || null })}
          placeholder="(default description)"
          className="w-full rounded-lg border border-gray-600 bg-gray-700 px-2.5 py-1.5 text-sm text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none resize-none"
        />
      </div>

      {/* Desc size */}
      <div>
        <p className="text-xs text-gray-400 mb-1.5">Description size</p>
        <div className="flex gap-1">
          {(["xs", "sm", "base"] as TextSize[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ descSize: s })}
              className={`rounded-md px-2.5 py-1 text-xs font-medium border transition ${
                card.descSize === s
                  ? "border-blue-500 bg-blue-600/30 text-blue-300"
                  : "border-gray-600 text-gray-400 hover:border-gray-500"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Font family */}
      <div>
        <p className="text-xs text-gray-400 mb-1.5">Font family</p>
        <div className="space-y-1">
          {(["inherit", "mono", "serif"] as FontFamily[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onChange({ fontFamily: f })}
              className={`w-full rounded-lg px-3 py-1.5 text-left text-sm border transition ${
                card.fontFamily === f
                  ? "border-blue-500 bg-blue-600/30 text-blue-200"
                  : "border-gray-600 text-gray-400 hover:border-gray-500"
              }`}
              style={{
                fontFamily:
                  f === "mono" ? "monospace" : f === "serif" ? "serif" : undefined,
              }}
            >
              {f === "inherit" ? "Default (sans-serif)" : f === "mono" ? "Monospace" : "Serif"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main SettingsLayoutTab ───────────────────────────────────────────────────

export function SettingsLayoutTab() {
  const [config, setConfig] = useState<SettingsLayoutConfig>(DEFAULT_CONFIG);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [loadError, setLoadError] = useState(false);

  // Load existing config
  useEffect(() => {
    fetch("/api/admin/settings-layout")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d) => setConfig(d.config))
      .catch(() => setLoadError(true));
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Keep cards sorted by `order`
  const sortedCards = [...config.cards].sort((a, b) => a.order - b.order);
  const ids = sortedCards.map((c) => c.id);

  const selectedCard = config.cards.find((c) => c.id === selectedId) ?? null;

  const updateCard = useCallback((id: string, patch: Partial<CardConfig>) => {
    setConfig((prev) => ({
      ...prev,
      cards: prev.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
    setStatus("idle");
  }, []);

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(e.active.id as string);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    const reordered = arrayMove(sortedCards, oldIndex, newIndex);

    setConfig((prev) => ({
      ...prev,
      cards: reordered.map((c, i) => ({ ...c, order: i })),
    }));
    setStatus("idle");
  };

  const handleSave = async () => {
    setStatus("saving");
    try {
      const res = await fetch("/api/admin/settings-layout", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!res.ok) throw new Error();
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    }
  };

  const handleReset = () => {
    if (!confirm("Reset settings layout to defaults? This cannot be undone.")) return;
    setConfig(DEFAULT_CONFIG);
    setStatus("idle");
  };

  if (loadError) {
    return (
      <p className="text-red-400 text-sm">Failed to load layout config. Check console.</p>
    );
  }

  const draggedCard = activeId ? config.cards.find((c) => c.id === activeId) : null;

  return (
    <div className="flex gap-6 min-h-[600px]">
      {/* ── Left: Grid canvas ── */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-100">Settings page layout</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Drag cards to reorder. Click to edit properties. Changes apply globally for all users.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg border border-gray-600 px-3 py-1.5 text-xs text-gray-400 hover:border-gray-400 hover:text-gray-200 transition"
            >
              Reset defaults
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={status === "saving"}
              className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition ${
                status === "saved"
                  ? "bg-green-600 text-white"
                  : status === "error"
                  ? "bg-red-600 text-white"
                  : "bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-60"
              }`}
            >
              {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : status === "error" ? "Error" : "Save layout"}
            </button>
          </div>
        </div>

        {/* Snap grid hint */}
        <div className="mb-3 flex items-center gap-2">
          <div className="h-px flex-1 bg-gray-800" />
          <span className="text-[10px] text-gray-600 uppercase tracking-widest">2-column snap grid</span>
          <div className="h-px flex-1 bg-gray-800" />
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            {/* Visual 2-col grid */}
            <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl border border-gray-800 bg-gray-900/50 min-h-[400px]">
              {sortedCards.map((card) => (
                <SortableCardTile
                  key={card.id}
                  card={card}
                  selected={selectedId === card.id}
                  onClick={() => setSelectedId(card.id === selectedId ? null : card.id)}
                />
              ))}
            </div>
          </SortableContext>

          <DragOverlay>
            {draggedCard ? <CardGhost card={draggedCard} /> : null}
          </DragOverlay>
        </DndContext>

        <p className="mt-3 text-xs text-gray-600">
          Cards span 2 columns = full-width. Cards span 1 column = half-width. Set in the Properties panel →
        </p>
      </div>

      {/* ── Right: Properties panel ── */}
      <div className="w-64 shrink-0">
        <div className="sticky top-4 rounded-2xl border border-gray-700 bg-gray-800/80 p-4">
          {selectedCard ? (
            <PropertiesPanel
              card={selectedCard}
              onChange={(patch) => updateCard(selectedCard.id, patch)}
            />
          ) : (
            <div className="text-center py-8">
              <div className="w-8 h-8 rounded-full border-2 border-dashed border-gray-600 flex items-center justify-center mx-auto mb-3">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" className="text-gray-600">
                  <path d="M8 3a1 1 0 0 1 1 1v3h3a1 1 0 0 1 0 2H9v3a1 1 0 0 1-2 0V9H4a1 1 0 0 1 0-2h3V4a1 1 0 0 1 1-1z"/>
                </svg>
              </div>
              <p className="text-xs text-gray-500">Click a card to edit its properties</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
