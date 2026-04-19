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
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";

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
  LAYOUT_STATE_KEYS,
  LAYOUT_STATE_LABELS,
  mergeWithDefaults,
} from "@/lib/types/settings-layout";

// ── Individual draggable + droppable card tile ────────────────────────────────

function CardTile({
  card,
  selected,
  onClick,
}: {
  card: CardConfig;
  selected: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } =
    useDraggable({ id: card.id });

  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `drop-${card.id}` });

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <div
      ref={setRef}
      onClick={onClick}
      style={{ gridColumn: card.span === 2 ? "1 / -1" : undefined }}
      className={`group relative rounded-xl border-2 cursor-pointer transition-colors select-none
        ${selected ? "border-blue-500 bg-blue-950/40 shadow-lg shadow-blue-900/30" : "border-gray-700 bg-gray-800/60"}
        ${isOver && !isDragging ? "border-blue-400 bg-blue-900/30 ring-2 ring-blue-500/40" : ""}
        ${isDragging ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-900" : "hover:border-gray-500"}
        ${!card.visible ? "opacity-40" : ""}
      `}
    >
      <button
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="absolute top-2 right-2 p-1 rounded text-gray-500 hover:text-gray-300 cursor-grab active:cursor-grabbing touch-none"
        title="Drag to reorder"
        tabIndex={-1}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5" cy="4" r="1.5" /><circle cx="11" cy="4" r="1.5" />
          <circle cx="5" cy="8" r="1.5" /><circle cx="11" cy="8" r="1.5" />
          <circle cx="5" cy="12" r="1.5" /><circle cx="11" cy="12" r="1.5" />
        </svg>
      </button>

      <div className="p-3 pr-8">
        <div className="flex items-center gap-2 mb-1">
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

function CardGhost({ card }: { card: CardConfig }) {
  return (
    <div className="rounded-xl border-2 border-blue-400 bg-blue-900/70 p-3 shadow-2xl w-48 rotate-2 pointer-events-none">
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

// ── State selector strip ─────────────────────────────────────────────────────

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
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-600">Copy from:</span>
          {LAYOUT_STATE_KEYS.filter((k) => k !== activeState).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onCopyFrom(k)}
              className="text-[10px] rounded border border-gray-700 px-2 py-0.5 text-gray-400 hover:border-gray-500 hover:text-gray-200 transition"
              title={`Copy cards from ${LAYOUT_STATE_LABELS[k]}`}
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
            <div className="mt-0.5 text-[9px] uppercase tracking-wider opacity-70">
              {k === "cacheOff_breaksOff" && "No cache · No breaks"}
              {k === "cacheOff_breaksOn"  && "No cache · Breaks"}
              {k === "cacheOn_breaksOff"  && "Cache · No breaks"}
              {k === "cacheOn_breaksOn"   && "Cache · Breaks"}
            </div>
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
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Active state's card list (never null thanks to mergeWithDefaults)
  const stateCards = config.states[activeState] ?? DEFAULT_CONFIG.states[activeState];
  const sortedCards = [...stateCards].sort((a, b) => a.order - b.order);
  const selectedCard = stateCards.find((c) => c.id === selectedId) ?? null;

  /** Mutate one card within the currently active state only */
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
    if (!over) return;

    const overId = (over.id as string).replace(/^drop-/, "");
    if (active.id === overId) return;

    // Pure swap within the active state only
    const cards = config.states[activeState];
    const a = cards.find((c) => c.id === active.id);
    const b = cards.find((c) => c.id === overId);
    if (!a || !b) return;

    const aOrder = a.order;
    const bOrder = b.order;

    setConfig((prev) => ({
      ...prev,
      states: {
        ...prev.states,
        [activeState]: prev.states[activeState].map((c) => {
          if (c.id === active.id) return { ...c, order: bOrder };
          if (c.id === overId)    return { ...c, order: aOrder };
          return c;
        }),
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
              Each of the 4 states (cache × breaks) has its own independent layout. Drag cards to reorder. Click to edit properties.
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
            {LAYOUT_STATE_LABELS[activeState]} · drag handle to move
          </span>
          <div className="h-px flex-1 bg-gray-800" />
        </div>

        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl border border-gray-800 bg-gray-900/50 min-h-[400px] items-start">
            {sortedCards.map((card) => (
              <CardTile
                key={card.id}
                card={card}
                selected={selectedId === card.id}
                onClick={() => setSelectedId(card.id === selectedId ? null : card.id)}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {draggedCard ? <CardGhost card={draggedCard} /> : null}
          </DragOverlay>
        </DndContext>

        <p className="mt-3 text-xs text-gray-600">
          Drag handle (⋮⋮) to reorder · Click card to open properties panel → · Edits apply to the selected state only
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
