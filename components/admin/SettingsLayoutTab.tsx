"use client";

import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  type CardConfig,
  type SettingsLayoutConfig,
  type FontFamily,
  type TitleSize,
  type TextSize,
  type CardSpan,
  type LayoutStateKey,
  DEFAULT_CONFIG,
  CARD_LABELS,
  CARD_DEFAULT_DESCRIPTIONS,
  LAYOUT_STATE_KEYS,
  LAYOUT_STATE_LABELS,
  mergeWithDefaults,
} from "@/lib/types/settings-layout";

// ── Helpers ──────────────────────────────────────────────────────────────────

function cardFontStyle(f: FontFamily): React.CSSProperties {
  if (f === "mono") return { fontFamily: "monospace" };
  if (f === "serif") return { fontFamily: "serif" };
  return {};
}

function titleSizeClass(s: TitleSize) { return `text-${s} font-semibold`; }
function descSizeClass(s: TextSize)   { return `text-${s} text-gray-400 leading-relaxed`; }

/** Mini preview of a settings card — mirrors the real settings page styling */
function CardPreview({ card, selected, isOver }: { card: CardConfig; selected: boolean; isOver: boolean }) {
  const title = card.titleText ?? CARD_LABELS[card.id] ?? card.id;
  const desc  = card.descText ?? CARD_DEFAULT_DESCRIPTIONS[card.id] ?? "";
  const isDog = card.id === "dog-photo";

  return (
    <div
      style={cardFontStyle(card.fontFamily)}
      className={`relative rounded-2xl border p-5 bg-gray-900
        ${selected ? "border-blue-500 shadow-lg shadow-blue-900/30 ring-1 ring-blue-400/40" : "border-gray-700"}
        ${isOver ? "ring-2 ring-blue-500/60" : ""}
        ${!card.visible ? "opacity-40" : ""}
      `}
    >
      {/* corner badges */}
      <div className="absolute top-2 left-2 flex items-center gap-1">
        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded
          ${card.span === 2 ? "bg-indigo-600/60 text-indigo-200" : "bg-gray-800 text-gray-400"}`}>
          {card.span === 2 ? "Full" : "Half"}
        </span>
        {!card.visible && (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-900/50 text-red-400">
            Hidden
          </span>
        )}
      </div>

      {/* mini preview content */}
      <div className="mt-3">
        {isDog ? (
          <div className="flex items-center justify-center py-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/easter-egg-dog.png" alt="Dog preview" className="h-24 w-24 object-cover rounded-xl" />
          </div>
        ) : (
          <>
            <h2 className={`${titleSizeClass(card.titleSize)} text-gray-100 mb-1`}>{title}</h2>
            {desc && (
              <p className={`${descSizeClass(card.descSize)} line-clamp-3`}>{desc}</p>
            )}
          </>
        )}
      </div>

      <p className="mt-3 text-[10px] text-gray-600">
        font: {card.fontFamily} · title: {card.titleSize} · body: {card.descSize}
      </p>
    </div>
  );
}

// ── Sortable wrapper ─────────────────────────────────────────────────────────

function SortableCard({
  card,
  selected,
  onClick,
}: {
  card: CardConfig;
  selected: boolean;
  onClick: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: card.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    gridColumn: card.span === 2 ? "1 / -1" : undefined,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      className="relative cursor-pointer select-none"
    >
      {/* Drag handle — top-right grip */}
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="absolute top-2 right-2 z-10 p-1.5 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-800 cursor-grab active:cursor-grabbing touch-none"
        title="Drag to reorder"
        tabIndex={-1}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5" cy="4" r="1.5" /><circle cx="11" cy="4" r="1.5" />
          <circle cx="5" cy="8" r="1.5" /><circle cx="11" cy="8" r="1.5" />
          <circle cx="5" cy="12" r="1.5" /><circle cx="11" cy="12" r="1.5" />
        </svg>
      </button>

      <CardPreview card={card} selected={selected} isOver={isOver} />
    </div>
  );
}

/** Lightweight floating ghost while dragging */
function CardGhost({ card }: { card: CardConfig }) {
  return (
    <div className="w-full opacity-80" style={{ transform: "scale(1.02)" }}>
      <CardPreview card={card} selected={false} isOver={false} />
    </div>
  );
}

// ── Properties panel ─────────────────────────────────────────────────────────

function PropertiesPanel({
  card,
  onChange,
}: {
  card: CardConfig;
  onChange: (patch: Partial<CardConfig>) => void;
}) {
  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-gray-200">
        {CARD_LABELS[card.id] ?? card.id}
      </h3>

      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-xs text-gray-400">Visible</span>
        <button
          type="button"
          onClick={() => onChange({ visible: !card.visible })}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${card.visible ? "bg-blue-600" : "bg-gray-600"}`}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${card.visible ? "translate-x-4" : "translate-x-1"}`} />
        </button>
      </label>

      <div>
        <p className="text-xs text-gray-400 mb-1.5">Card width</p>
        <div className="grid grid-cols-2 gap-1.5">
          {([1, 2] as CardSpan[]).map((s) => (
            <button key={s} type="button" onClick={() => onChange({ span: s })}
              className={`rounded-lg py-1.5 text-xs font-medium border transition ${card.span === s ? "border-blue-500 bg-blue-600/30 text-blue-300" : "border-gray-600 text-gray-400 hover:border-gray-500"}`}>
              {s === 1 ? "Half (1 col)" : "Full (2 col)"}
            </button>
          ))}
        </div>
      </div>

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

      <div>
        <p className="text-xs text-gray-400 mb-1.5">Heading size</p>
        <div className="flex gap-1 flex-wrap">
          {(["xs", "sm", "base", "lg", "xl"] as TitleSize[]).map((s) => (
            <button key={s} type="button" onClick={() => onChange({ titleSize: s })}
              className={`rounded-md px-2.5 py-1 text-xs font-medium border transition ${card.titleSize === s ? "border-blue-500 bg-blue-600/30 text-blue-300" : "border-gray-600 text-gray-400 hover:border-gray-500"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Description text</label>
        <textarea rows={3} value={card.descText ?? ""} onChange={(e) => onChange({ descText: e.target.value || null })}
          placeholder="(default description)"
          className="w-full rounded-lg border border-gray-600 bg-gray-700 px-2.5 py-1.5 text-sm text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none resize-none" />
      </div>

      <div>
        <p className="text-xs text-gray-400 mb-1.5">Description size</p>
        <div className="flex gap-1">
          {(["xs", "sm", "base"] as TextSize[]).map((s) => (
            <button key={s} type="button" onClick={() => onChange({ descSize: s })}
              className={`rounded-md px-2.5 py-1 text-xs font-medium border transition ${card.descSize === s ? "border-blue-500 bg-blue-600/30 text-blue-300" : "border-gray-600 text-gray-400 hover:border-gray-500"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-gray-400 mb-1.5">Font family</p>
        <div className="space-y-1">
          {(["inherit", "mono", "serif"] as FontFamily[]).map((f) => (
            <button key={f} type="button" onClick={() => onChange({ fontFamily: f })}
              className={`w-full rounded-lg px-3 py-1.5 text-left text-sm border transition ${card.fontFamily === f ? "border-blue-500 bg-blue-600/30 text-blue-200" : "border-gray-600 text-gray-400 hover:border-gray-500"}`}
              style={{ fontFamily: f === "mono" ? "monospace" : f === "serif" ? "serif" : undefined }}>
              {f === "inherit" ? "Default (sans-serif)" : f === "mono" ? "Monospace" : "Serif"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── State selector ───────────────────────────────────────────────────────────

function StateSelector({
  activeState,
  onSelect,
  onCopyFrom,
}: {
  activeState: LayoutStateKey;
  onSelect: (s: LayoutStateKey) => void;
  onCopyFrom: (src: LayoutStateKey) => void;
}) {
  return (
    <div className="mb-4 rounded-xl border border-gray-800 bg-gray-900/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
          Editing layout for state
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-gray-600">Copy from:</span>
          {LAYOUT_STATE_KEYS.filter((k) => k !== activeState).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onCopyFrom(k)}
              className="text-[10px] rounded border border-gray-700 px-2 py-0.5 text-gray-400 hover:border-gray-500 hover:text-gray-200 transition"
            >
              {LAYOUT_STATE_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {LAYOUT_STATE_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onSelect(k)}
            className={`rounded-lg px-3 py-2 text-xs font-medium border transition text-left
              ${activeState === k
                ? "border-blue-500 bg-blue-600/30 text-blue-200 shadow-md shadow-blue-900/30"
                : "border-gray-700 bg-gray-800/60 text-gray-400 hover:border-gray-500 hover:text-gray-200"}
            `}
          >
            <div className="font-semibold text-[11px]">{LAYOUT_STATE_LABELS[k]}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main SettingsLayoutTab ───────────────────────────────────────────────────

export function SettingsLayoutTab() {
  const [config, setConfig] = useState<SettingsLayoutConfig>(DEFAULT_CONFIG);
  const [activeState, setActiveState] = useState<LayoutStateKey>("cacheOff_breaksOff");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings-layout")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d) => setConfig(mergeWithDefaults(d.config)))
      .catch(() => setLoadError(true));
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const stateCards = config.states[activeState] ?? DEFAULT_CONFIG.states[activeState];
  const sortedCards = [...stateCards].sort((a, b) => a.order - b.order);
  const sortedIds = sortedCards.map((c) => c.id);
  const selectedCard = stateCards.find((c) => c.id === selectedId) ?? null;

  const updateCard = useCallback(
    (id: string, patch: Partial<CardConfig>) => {
      setConfig((prev) => ({
        ...prev,
        states: {
          ...prev.states,
          [activeState]: prev.states[activeState].map((c) =>
            c.id === id ? { ...c, ...patch } : c
          ),
        },
      }));
      setStatus("idle");
    },
    [activeState]
  );

  const handleDragStart = (e: DragStartEvent) => setActiveId(e.active.id as string);

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const oldIndex = sortedIds.indexOf(active.id as string);
    const newIndex = sortedIds.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    // Proper sortable insertion — all cards flow to fill the gap
    const newSorted = arrayMove(sortedCards, oldIndex, newIndex);
    const orderById = new Map(newSorted.map((c, i) => [c.id, i]));

    setConfig((prev) => ({
      ...prev,
      states: {
        ...prev.states,
        [activeState]: prev.states[activeState].map((c) => ({
          ...c,
          order: orderById.get(c.id) ?? c.order,
        })),
      },
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

  const handleResetAll = () => {
    if (!confirm("Reset ALL 4 state layouts to defaults? This cannot be undone.")) return;
    setConfig(DEFAULT_CONFIG);
    setStatus("idle");
  };

  const handleResetState = () => {
    if (!confirm(`Reset only "${LAYOUT_STATE_LABELS[activeState]}" to defaults?`)) return;
    setConfig((prev) => ({
      ...prev,
      states: {
        ...prev.states,
        [activeState]: DEFAULT_CONFIG.states[activeState].map((c) => ({ ...c })),
      },
    }));
    setStatus("idle");
  };

  const handleCopyFrom = (src: LayoutStateKey) => {
    if (!confirm(`Overwrite "${LAYOUT_STATE_LABELS[activeState]}" with cards from "${LAYOUT_STATE_LABELS[src]}"?`)) return;
    setConfig((prev) => ({
      ...prev,
      states: {
        ...prev.states,
        [activeState]: prev.states[src].map((c) => ({ ...c })),
      },
    }));
    setStatus("idle");
  };

  if (loadError) {
    return <p className="text-red-400 text-sm">Failed to load layout config. Check console.</p>;
  }

  const draggedCard = activeId ? stateCards.find((c) => c.id === activeId) : null;

  return (
    <div className="flex gap-6 min-h-[600px]">
      {/* ── Left: Grid canvas ── */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-100">Settings page layout</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Live preview — tiles match the real card appearance. Drag the handle to reorder. Click a card to edit its properties.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleResetState}
              className="rounded-lg border border-gray-600 px-3 py-1.5 text-xs text-gray-400 hover:border-gray-400 hover:text-gray-200 transition">
              Reset this state
            </button>
            <button type="button" onClick={handleResetAll}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-500 hover:border-red-500 hover:text-red-400 transition">
              Reset all
            </button>
            <button type="button" onClick={handleSave} disabled={status === "saving"}
              className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition ${status === "saved" ? "bg-green-600 text-white" : status === "error" ? "bg-red-600 text-white" : "bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-60"}`}>
              {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : status === "error" ? "Error" : "Save layout"}
            </button>
          </div>
        </div>

        <StateSelector
          activeState={activeState}
          onSelect={(s) => { setActiveState(s); setSelectedId(null); }}
          onCopyFrom={handleCopyFrom}
        />

        <div className="mb-3 flex items-center gap-2">
          <div className="h-px flex-1 bg-gray-800" />
          <span className="text-[10px] text-gray-600 uppercase tracking-widest">
            {LAYOUT_STATE_LABELS[activeState]} · drag to reorder · cards flow to fill gaps
          </span>
          <div className="h-px flex-1 bg-gray-800" />
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={sortedIds} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 gap-4 p-5 rounded-2xl border border-gray-800 bg-gray-950/60 min-h-[400px] items-start">
              {sortedCards.map((card) => (
                <SortableCard
                  key={card.id}
                  card={card}
                  selected={selectedId === card.id}
                  onClick={() => setSelectedId(card.id === selectedId ? null : card.id)}
                />
              ))}
            </div>
          </SortableContext>

          <DragOverlay dropAnimation={null}>
            {draggedCard ? <CardGhost card={draggedCard} /> : null}
          </DragOverlay>
        </DndContext>

        <p className="mt-3 text-xs text-gray-600">
          Drag handle (⋮⋮) to reorder · click a card to open properties · other cards flow to fill the vacated spot
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
                  <path d="M8 3a1 1 0 0 1 1 1v3h3a1 1 0 0 1 0 2H9v3a1 1 0 0 1-2 0V9H4a1 1 0 0 1 0-2h3V4a1 1 0 0 1 1-1z" />
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
