"use client";

import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import type { SettingsUiElement } from "@/lib/settings-ui";

const ZOOM_PRESETS = [
  { label: "Small", value: 0.75 },
  { label: "Normal", value: 1 },
  { label: "Large", value: 1.25 },
  { label: "Extra Large", value: 1.5 },
] as const;

const ZOOM_KEYS = ["textbook-zoom-small", "textbook-zoom-normal", "textbook-zoom-large", "textbook-zoom-xl"] as const;

function styleFromEl(el: SettingsUiElement | undefined): React.CSSProperties {
  if (!el) return {};
  const s: React.CSSProperties = {};
  if (el.fontFamily) s.fontFamily = el.fontFamily;
  if (el.fontSize) s.fontSize = el.fontSize;
  if (el.color) s.color = el.color;
  if (el.fontWeight) s.fontWeight = el.fontWeight as React.CSSProperties["fontWeight"];
  if (el.textDecoration === "underline") s.textDecoration = "underline";
  return s;
}

export function SettingsUiEditorTab() {
  const [draft, setDraft] = useState<Record<string, SettingsUiElement>>({});
  const [loading, setLoading] = useState(true);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<{ key: string; prev: SettingsUiElement | undefined }[]>([]);
  const [applyStatus, setApplyStatus] = useState<"idle" | "saving" | "ok" | "err">("idle");

  useEffect(() => {
    fetch("/api/admin/settings-ui")
      .then((r) => (r.ok ? r.json() : { elements: {} }))
      .then((d: { elements?: Record<string, SettingsUiElement> }) => setDraft(d.elements ?? {}))
      .catch(() => setDraft({}))
      .finally(() => setLoading(false));
  }, []);

  const el = activeKey ? draft[activeKey] : undefined;

  const formText = el?.text ?? "";
  const formFont = el?.fontFamily ?? "";
  const formSize = el?.fontSize?.replace("px", "") ?? "";
  const formColor = el?.color ?? "#e2e8f0";
  const formBold = el?.fontWeight === "700" || el?.fontWeight === "bold";
  const formUnderline = el?.textDecoration === "underline";

  const draftRef = useRef(draft);
  draftRef.current = draft;

  const openEditor = useCallback((suiKey: string) => {
    setUndoStack((prev) => [...prev, { key: suiKey, prev: draftRef.current[suiKey] }]);
    setActiveKey(suiKey);
  }, []);

  const undoOne = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setDraft((d) => {
        const next = { ...d };
        if (last.prev === undefined) delete next[last.key];
        else next[last.key] = last.prev;
        return next;
      });
      return prev.slice(0, -1);
    });
  }, []);

  const updateActive = useCallback((patch: Partial<SettingsUiElement>) => {
    if (!activeKey) return;
    setDraft((d) => ({
      ...d,
      [activeKey]: { ...d[activeKey], ...patch },
    }));
  }, [activeKey]);

  const applyGlobal = useCallback(async () => {
    setApplyStatus("saving");
    try {
      const res = await fetch("/api/admin/settings-ui", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, elements: draft }),
      });
      if (!res.ok) throw new Error("save failed");
      setApplyStatus("ok");
      setTimeout(() => setApplyStatus("idle"), 2500);
    } catch {
      setApplyStatus("err");
    }
  }, [draft]);

  const Editable = useMemo(() => {
    function Inner({
      suiKey,
      def,
      className,
      as: Tag = "span",
    }: {
      suiKey: string;
      def: string;
      className?: string;
      as?: keyof JSX.IntrinsicElements;
    }) {
      const row = draft[suiKey];
      const style = styleFromEl(row);
      const text = row?.text ?? def;
      return (
        <Tag
          className={`${className ?? ""} cursor-context-menu rounded px-0.5 decoration-inherit hover:ring-1 hover:ring-slate-500/40`}
          style={style}
          onContextMenu={(e) => {
            e.preventDefault();
            openEditor(suiKey);
          }}
        >
          {text}
        </Tag>
      );
    }
    return Inner;
  }, [draft, openEditor]);

  if (loading) {
    return <p className="text-gray-400 animate-pulse">Loading editor…</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-400 max-w-2xl">
        Preview matches the live Settings layout (Daily goals, Account, Textbook display size).{" "}
        <strong className="text-gray-200">Right-click</strong> any text to edit copy and typography.{" "}
        Use <strong className="text-gray-200">Undo</strong> for the last change, then{" "}
        <strong className="text-gray-200">Apply globally</strong> to save for all signed-in users (public Settings page).
      </p>

      <div className="flex flex-wrap gap-3 items-center">
        <button
          type="button"
          onClick={undoOne}
          disabled={undoStack.length === 0}
          className="rounded-lg border border-gray-600 px-4 py-2 text-sm disabled:opacity-40"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={() => void applyGlobal()}
          disabled={applyStatus === "saving"}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {applyStatus === "saving" ? "Applying…" : "Apply globally"}
        </button>
        {applyStatus === "ok" && <span className="text-sm text-green-400">Saved.</span>}
        {applyStatus === "err" && <span className="text-sm text-red-400">Could not save.</span>}
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-950 p-6 md:p-8 text-slate-100">
        <div className="flex items-center gap-4 mb-6">
          <span className="text-sm text-slate-500 underline underline-offset-4">← Dashboard</span>
          <h2 className="text-2xl font-bold text-white">
            <Editable suiKey="settings.page-title" def="Settings" />
          </h2>
        </div>

        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6">
            <h3 className="text-base font-semibold mb-1">
              <Editable suiKey="daily-goals.title" def="Daily goals" />
            </h3>
            <p className="text-sm text-slate-400 mb-5 leading-relaxed">
              <Editable
                suiKey="daily-goals.desc"
                def="Set targets for each day. Your progress towards these will be shown on the dashboard. Leave a field blank to disable that goal."
                as="span"
              />
            </p>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  <Editable suiKey="daily-goals.label.minutes" def="Minutes per day" />
                </label>
                <div className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-500">60</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  <Editable suiKey="daily-goals.label.sessions" def="Sessions per day" />
                </label>
                <div className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-500">2</div>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-400 mb-1">
                <Editable suiKey="daily-goals.label.inactivity" def="Inactivity timeout" />
              </label>
              <p className="text-xs text-slate-500 mb-1.5">
                <Editable
                  suiKey="daily-goals.hint.inactivity"
                  def="Pause timer & ask if you're still reading after this many minutes of no interaction. Leave blank for default (3 min)."
                />
              </p>
              <div className="w-40 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-500">3</div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                <Editable suiKey="daily-goals.label.quiz" def="Quiz question count" />
              </label>
              <div className="mb-2 flex flex-wrap items-center gap-3 text-slate-300">
                <div className="w-28 min-w-[7rem] rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-center">3</div>
                <span className="text-xs text-slate-500">to</span>
                <div className="w-28 min-w-[7rem] rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-center">10</div>
              </div>
              <p className="text-xs text-slate-500">
                <Editable
                  suiKey="daily-goals.hint.quiz"
                  def="After each session the quiz scales with pages read. Set your min and max. Leave blank for defaults (min 3, max 10). Max allowed: 25."
                />
              </p>
            </div>
            <div className="mt-5 rounded-lg bg-blue-600 py-2.5 text-center text-sm font-medium text-white">
              <Editable suiKey="daily-goals.save" def="Save goals" />
            </div>
          </section>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6">
              <h3 className="text-base font-semibold mb-1">
                <Editable suiKey="account.title" def="Account" />
              </h3>
              <p className="text-sm text-slate-400 mb-4">
                <Editable suiKey="account.signed-prefix" def="Signed in as" />{" "}
                <span className="font-semibold text-white">admin</span>
              </p>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                <Editable suiKey="account.label.display-name" def="Display name" />
              </label>
              <div className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm mb-4">admin</div>
              <div className="rounded-lg bg-blue-600 py-2.5 text-center text-sm font-medium text-white">
                <Editable suiKey="account.save" def="Save name" />
              </div>
            </section>

            <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6">
              <h3 className="text-base font-semibold mb-1">
                <Editable suiKey="textbook-size.title" def="Textbook display size" />
              </h3>
              <p className="text-sm text-slate-400 mb-5">
                <Editable
                  suiKey="textbook-size.desc"
                  def="Controls how large the PDF pages appear while reading. Saved on this device."
                />
              </p>
              <div className="grid grid-cols-4 gap-2">
                {ZOOM_PRESETS.map((preset, i) => (
                  <div
                    key={preset.value}
                    className={`rounded-lg border py-3 text-center text-sm font-medium ${
                      preset.value === 1 ? "border-blue-600 bg-blue-600 text-white" : "border-slate-600 text-slate-200"
                    }`}
                  >
                    <Editable suiKey={ZOOM_KEYS[i]} def={preset.label} />
                    <span className="block text-xs opacity-60 mt-0.5">{Math.round(preset.value * 100)}%</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>

      {activeKey && (
        <div className="fixed bottom-6 right-6 z-50 w-full max-w-md rounded-2xl border border-slate-600 bg-slate-900 p-5 shadow-2xl">
          <div className="flex justify-between items-start mb-3">
            <h4 className="text-sm font-semibold text-white">Edit: {activeKey}</h4>
            <button type="button" className="text-slate-400 hover:text-white text-lg leading-none" onClick={() => setActiveKey(null)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="text-slate-400 text-xs">Text</span>
              <textarea
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white"
                rows={3}
                value={formText}
                onChange={(e) => updateActive({ text: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="text-slate-400 text-xs">Font</span>
              <select
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2"
                value={formFont || "inherit"}
                onChange={(e) => updateActive({ fontFamily: e.target.value === "inherit" ? undefined : e.target.value })}
              >
                <option value="inherit">Default</option>
                <option value="system-ui, sans-serif">System UI</option>
                <option value="Georgia, serif">Georgia</option>
                <option value="ui-serif, serif">Serif</option>
                <option value="Arial, Helvetica, sans-serif">Arial</option>
                <option value="'Times New Roman', Times, serif">Times New Roman</option>
              </select>
            </label>
            <label className="block">
              <span className="text-slate-400 text-xs">Size (px)</span>
              <input
                type="number"
                min={10}
                max={48}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2"
                value={formSize}
                onChange={(e) => {
                  const v = e.target.value;
                  updateActive({ fontSize: v ? `${v}px` : undefined });
                }}
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-slate-400 text-xs">Color</span>
              <input
                type="color"
                className="h-8 w-14 cursor-pointer rounded border border-slate-600 bg-transparent"
                value={formColor.startsWith("#") ? formColor : "#e2e8f0"}
                onChange={(e) => updateActive({ color: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formBold}
                onChange={(e) => updateActive({ fontWeight: e.target.checked ? "700" : undefined })}
              />
              <span className="text-slate-300">Bold</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formUnderline}
                onChange={(e) => updateActive({ textDecoration: e.target.checked ? "underline" : undefined })}
              />
              <span className="text-slate-300">Underline</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
