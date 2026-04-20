"use client";

import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import {
  compoundKey,
  ensureAllPages,
  parseCompoundKey,
  type UiCopyElement,
  type UiCopyPayload,
  type UiPageId,
  UI_PAGE_IDS,
} from "@/lib/ui-copy-shared";

const ZOOM_PRESETS = [
  { label: "Small", value: 0.75 },
  { label: "Normal", value: 1 },
  { label: "Large", value: 1.25 },
  { label: "Extra Large", value: 1.5 },
] as const;

const ZOOM_KEYS = ["textbook-zoom-small", "textbook-zoom-normal", "textbook-zoom-large", "textbook-zoom-xl"] as const;

function styleFromEl(el: UiCopyElement | undefined): React.CSSProperties {
  if (!el) return {};
  const s: React.CSSProperties = {};
  if (el.fontFamily) s.fontFamily = el.fontFamily;
  if (el.fontSize) s.fontSize = el.fontSize;
  if (el.color) s.color = el.color;
  if (el.fontWeight) s.fontWeight = el.fontWeight as React.CSSProperties["fontWeight"];
  if (el.textDecoration === "underline") s.textDecoration = "underline";
  return s;
}

const PAGE_TAB_LABEL: Record<UiPageId, string> = {
  home: "Home",
  dashboard: "Dashboard",
  session: "Session start",
  settings: "Settings",
};

export function AppUiEditorTab() {
  const [draft, setDraft] = useState<Record<UiPageId, Record<string, UiCopyElement>>>(() =>
    ensureAllPages({})
  );
  const [pageTab, setPageTab] = useState<UiPageId>("home");
  const [loading, setLoading] = useState(true);
  const [activeCompound, setActiveCompound] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<{ compound: string; prev: UiCopyElement | undefined }[]>([]);
  const [applyStatus, setApplyStatus] = useState<"idle" | "saving" | "ok" | "err">("idle");

  useEffect(() => {
    fetch("/api/admin/ui-copy")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: UiCopyPayload | null) => {
        if (d?.pages) setDraft(ensureAllPages(d.pages));
      })
      .catch(() => setDraft(ensureAllPages({})))
      .finally(() => setLoading(false));
  }, []);

  const activeParsed = activeCompound ? parseCompoundKey(activeCompound) : null;
  const el = activeParsed ? draft[activeParsed.page]?.[activeParsed.k] : undefined;

  const formText = el?.text ?? "";
  const formFont = el?.fontFamily ?? "";
  const formSize = el?.fontSize?.replace("px", "") ?? "";
  const formColor = el?.color ?? "#e2e8f0";
  const formBold = el?.fontWeight === "700" || el?.fontWeight === "bold";
  const formUnderline = el?.textDecoration === "underline";

  const draftRef = useRef(draft);
  draftRef.current = draft;

  const openEditor = useCallback((compound: string) => {
    const parsed = parseCompoundKey(compound);
    if (!parsed) return;
    setUndoStack((prev) => [
      ...prev,
      { compound, prev: draftRef.current[parsed.page]?.[parsed.k] },
    ]);
    setActiveCompound(compound);
  }, []);

  const undoOne = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      const parsed = parseCompoundKey(last.compound);
      if (!parsed) return prev.slice(0, -1);
      setDraft((d) => {
        const next = { ...d };
        const pg = { ...(next[parsed.page] ?? {}) };
        if (last.prev === undefined) delete pg[parsed.k];
        else pg[parsed.k] = last.prev;
        next[parsed.page] = pg;
        return next;
      });
      return prev.slice(0, -1);
    });
  }, []);

  const updateActive = useCallback(
    (patch: Partial<UiCopyElement>) => {
      if (!activeCompound) return;
      const parsed = parseCompoundKey(activeCompound);
      if (!parsed) return;
      setDraft((d) => ({
        ...d,
        [parsed.page]: {
          ...d[parsed.page],
          [parsed.k]: { ...d[parsed.page]?.[parsed.k], ...patch },
        },
      }));
    },
    [activeCompound]
  );

  const applyGlobal = useCallback(async () => {
    setApplyStatus("saving");
    try {
      const res = await fetch("/api/admin/ui-copy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 2, pages: ensureAllPages(draft) }),
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
      const row = draft[pageTab]?.[suiKey];
      const style = styleFromEl(row);
      const text = row?.text ?? def;
      const compound = compoundKey(pageTab, suiKey);
      return (
        <Tag
          className={`${className ?? ""} cursor-context-menu rounded px-0.5 decoration-inherit hover:ring-1 hover:ring-slate-500/40`}
          style={style}
          onContextMenu={(e) => {
            e.preventDefault();
            openEditor(compound);
          }}
        >
          {text}
        </Tag>
      );
    }
    return Inner;
  }, [draft, openEditor, pageTab]);

  if (loading) {
    return <p className="text-gray-400 animate-pulse">Loading editor…</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-400 max-w-2xl">
        Choose a screen (Home, Dashboard, Session start, or Settings).{" "}
        <strong className="text-gray-200">Right-click</strong> any text to edit typography.{" "}
        <strong className="text-gray-200">Undo</strong> then <strong className="text-gray-200">Apply globally</strong> saves all pages to the live app.
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

      <div className="flex flex-wrap gap-2 mb-4">
        {UI_PAGE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setPageTab(id)}
            className={`rounded-lg border px-4 py-2 text-sm transition ${
              pageTab === id
                ? "border-white bg-slate-800 text-white"
                : "border-gray-600 text-gray-400 hover:border-gray-400"
            }`}
          >
            {PAGE_TAB_LABEL[id]}
          </button>
        ))}
      </div>

      <div className="max-h-[min(78vh,960px)] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-6 md:p-8 text-slate-100">
        {pageTab === "home" && (
          <div className="space-y-8">
            <div className="flex items-center justify-between border-b border-slate-700 pb-4">
              <span className="text-lg font-bold">
                <Editable suiKey="nav.brand" def="Bowl Beacon" />
              </span>
              <div className="flex gap-2 text-sm">
                <span className="text-slate-400">
                  <Editable suiKey="nav.download" def="Download App" />
                </span>
                <span className="text-slate-400">
                  <Editable suiKey="nav.signin" def="Sign in" />
                </span>
                <span className="rounded bg-blue-600 px-2 py-1 text-xs text-white">
                  <Editable suiKey="nav.getstarted" def="Get started" />
                </span>
              </div>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">
                <Editable suiKey="hero.line1" def="Study smarter," as="span" />
                <br />
                <Editable suiKey="hero.line2" def="stay focused." as="span" />
              </h1>
              <p className="mt-4 text-sm text-slate-400 leading-relaxed max-w-xl">
                <Editable
                  suiKey="hero.body"
                  def="Upload a PDF or pick a textbook, set your timer, and start reading. Bowl Beacon keeps you on track with focus enforcement, AI-generated notes, end-of-session quizzes, and personalized review material."
                  as="span"
                />
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="rounded bg-blue-600 px-3 py-2 text-xs">
                  <Editable suiKey="hero.cta1" def="Start studying free" />
                </span>
                <span className="rounded border border-slate-600 px-3 py-2 text-xs">
                  <Editable suiKey="hero.cta2" def="View dashboard" />
                </span>
                <span className="rounded border border-slate-600 px-3 py-2 text-xs">
                  <Editable suiKey="hero.cta3" def="Download App" />
                </span>
              </div>
            </div>
            <div>
              <h2 className="text-xl font-bold text-center mb-4">
                <Editable suiKey="features.title" def="Everything you need to study effectively" />
              </h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {(
                  [
                    ["f1", "In-app reading", "Upload PDFs or browse our textbook catalog."],
                    ["f2", "Focus enforcement", "Timer pauses when you leave the tab."],
                    ["f3", "AI-powered notes", "Generate study notes from the pages you read."],
                    ["f4", "Quizzes", "End every session with an auto-generated quiz."],
                    ["f5", "Progress tracking", "Track your study time, sessions, and streaks."],
                    ["f6", "Review & videos", "Get personalized review material and curated videos."],
                  ] as const
                ).map(([k, t, d]) => (
                  <div key={k} className="rounded-lg border border-slate-700 p-3">
                    <Editable suiKey={`features.${k}.title`} def={t} />
                    <p className="mt-1 text-xs text-slate-500">
                      <Editable suiKey={`features.${k}.desc`} def={d} as="span" />
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="text-center border-t border-slate-700 pt-6">
              <span className="text-lg font-bold text-white block mb-2">
                <Editable suiKey="cta.title" def="Ready to study?" />
              </span>
              <p className="text-sm text-slate-400 mb-3">
                <Editable
                  suiKey="cta.body"
                  def="Create a free account and start your first session in under a minute."
                  as="span"
                />
              </p>
              <span className="inline-block rounded bg-blue-600 px-4 py-2 text-xs">
                <Editable suiKey="cta.button" def="Get started" />
              </span>
            </div>
          </div>
        )}

        {pageTab === "dashboard" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-white">
                  <Editable suiKey="title" def="Dashboard" />
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                  <Editable suiKey="subtitle" def="Your study progress at a glance" as="span" />
                </p>
              </div>
              <div className="flex gap-2 text-sm">
                <span className="rounded border border-red-800 px-2 py-1 text-red-400">
                  <Editable suiKey="btn.dev" def="Developer Mode" />
                </span>
                <span className="rounded border border-slate-600 px-2 py-1">
                  <Editable suiKey="btn.settings" def="Settings" />
                </span>
                <span className="rounded bg-blue-600 px-2 py-1 text-white">
                  <Editable suiKey="btn.newSession" def="New session" />
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-amber-700 bg-amber-900/20 p-4">
              <p className="text-sm font-semibold text-amber-300">
                <Editable suiKey="banner.unfinished" def="You have an unfinished session" />
              </p>
            </div>
            <div className="rounded-xl border border-slate-700 p-4">
              <p className="text-2xl font-bold text-green-300">3 days</p>
              <p className="text-sm text-green-400">
                <Editable suiKey="streak.strong" def="Streak going strong — keep it up!" as="span" />
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <section className="rounded-xl border border-slate-700 p-4">
                <h2 className="text-sm font-semibold">
                  <Editable suiKey="goals.title" def="Today's Goals" />
                </h2>
              </section>
              <section className="rounded-xl border border-slate-700 p-4">
                <h2 className="text-sm font-semibold">
                  <Editable suiKey="week.title" def="This Week" />
                </h2>
              </section>
            </div>
          </div>
        )}

        {pageTab === "session" && (
          <div className="space-y-6">
            <div className="flex justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-white mb-2">
                  <Editable suiKey="setup.title" def="Start a study session" />
                </h1>
                <p className="text-sm text-slate-400">
                  <Editable
                    suiKey="setup.subtitle"
                    def="Pick your reading material, set a goal, and start studying."
                    as="span"
                  />
                </p>
              </div>
              <div className="text-xs text-slate-500 text-right max-w-[10rem]">
                <Editable suiKey="pdf.off" def="PDF caching off" as="span" />
              </div>
            </div>
            <section>
              <h2 className="text-lg font-semibold mb-2">
                <Editable suiKey="step.material" def="1. Reading material" />
              </h2>
              <p className="text-xs text-slate-500">…</p>
            </section>
            <section>
              <h2 className="text-lg font-semibold mb-2">
                <Editable suiKey="step.goal" def="2. Study goal" />
              </h2>
              <label className="text-sm text-slate-400 block">
                <Editable suiKey="label.goalType" def="Goal type" />
              </label>
              <label className="text-sm text-slate-400 block mt-2">
                <Editable suiKey="label.minutes" def="Minutes" />
              </label>
            </section>
            <div className="rounded-lg bg-blue-600 py-2.5 text-center text-sm font-medium text-white">
              <Editable suiKey="btn.start" def="Start session" />
            </div>
            <p className="text-sm text-slate-500">
              <Editable suiKey="link.home" def="Back to home" as="span" />
            </p>
          </div>
        )}

        {pageTab === "settings" && (
        <>
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

          <p className="text-sm text-slate-500 px-1">
            More sections (scroll) — same cards as{" "}
            <code className="text-slate-400">/settings</code> below the fold.
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6">
              <h3 className="text-base font-semibold mb-1">
                <Editable suiKey="session-defaults.title" def="Session defaults" />
              </h3>
              <p className="text-sm text-slate-400 mb-4">
                <Editable
                  suiKey="session-defaults.desc"
                  def="Pre-fill the goal type and target whenever you start a new session."
                />
              </p>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {["time", "pages", "chapter"].map((t) => (
                  <div
                    key={t}
                    className={`rounded-lg border py-2 text-center text-xs font-medium capitalize ${t === "time" ? "border-blue-600 bg-blue-600 text-white" : "border-slate-600 text-slate-300"}`}
                  >
                    {t}
                  </div>
                ))}
              </div>
              <div className="rounded-lg bg-blue-600 py-2.5 text-center text-sm font-medium text-white">
                <Editable suiKey="session-defaults.save" def="Save defaults" />
              </div>
            </section>

            <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-semibold">
                  <Editable suiKey="study-breaks.title" def="Study breaks" />
                </h3>
                <div className="h-6 w-11 rounded-full bg-blue-600 relative">
                  <span className="absolute right-1 top-1 h-4 w-4 rounded-full bg-white shadow" />
                </div>
              </div>
              <p className="text-sm text-slate-400 mb-4">
                <Editable
                  suiKey="study-breaks.desc-on"
                  def="Cycles between focus and break intervals during study sessions."
                />
              </p>
              <p className="text-xs text-slate-500 mb-3">
                <span className="text-slate-500">(When off: </span>
                <Editable suiKey="study-breaks.desc-off" def="Off — sessions use a continuous timer." />
                <span className="text-slate-500">)</span>
              </p>
              <div className="rounded-lg bg-blue-600 py-2.5 text-center text-sm font-medium text-white">
                <Editable suiKey="study-breaks.save" def="Save break settings" />
              </div>
            </section>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-semibold">
                  <Editable suiKey="pdf-cache.title" def="Offline PDF cache" />
                </h3>
                <div className="h-6 w-11 rounded-full bg-blue-600 relative">
                  <span className="absolute right-1 top-1 h-4 w-4 rounded-full bg-white shadow" />
                </div>
              </div>
              <p className="text-sm text-slate-400 mb-2">
                <Editable
                  suiKey="pdf-cache.desc-on"
                  def="Textbooks you open are cached on this device so they load instantly and work offline. Older ones are evicted when either limit is reached."
                />
              </p>
              <p className="text-xs text-slate-500">
                <Editable
                  suiKey="pdf-cache.desc-off"
                  def="Caching is off. Textbooks will always load from the network and won't be available offline."
                />
              </p>
            </section>

            <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6">
              <h3 className="text-base font-semibold mb-1">
                <Editable suiKey="exit-password.title" def="Exit password" />
              </h3>
              <p className="text-sm text-slate-400 mb-4">
                <Editable
                  suiKey="exit-password.desc"
                  def="Required to end a study session early. Defaults to your login password if not changed."
                />
              </p>
              <div className="space-y-2 mb-4">
                <div className="h-9 rounded-lg border border-slate-600 bg-slate-800" />
                <div className="h-9 rounded-lg border border-slate-600 bg-slate-800" />
              </div>
              <div className="rounded-lg bg-blue-600 py-2.5 text-center text-sm font-medium text-white">
                <Editable suiKey="exit-password.save" def="Save exit password" />
              </div>
            </section>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6">
              <h3 className="text-base font-semibold mb-1">
                <Editable suiKey="upload-storage.title" def="Upload storage" />
              </h3>
              <p className="text-sm text-slate-400 mb-4">
                <Editable suiKey="upload-storage.desc" def="Space used by your uploaded PDFs." />
              </p>
              <div className="h-2.5 rounded-full bg-slate-700 overflow-hidden">
                <div className="h-full w-1/3 rounded-full bg-blue-500" />
              </div>
              <p className="text-xs text-slate-500 mt-2">42% of your quota used</p>
            </section>

            <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6">
              <h3 className="text-base font-semibold mb-1">
                <Editable suiKey="focus-music.title" def="Focus music" />
              </h3>
              <p className="text-sm text-slate-400 mb-4">
                <Editable
                  suiKey="focus-music.desc"
                  def="Build a study playlist. Search for songs or paste a URL. Music loops automatically during sessions. Saved on this device."
                />
              </p>
              <div className="flex gap-2">
                <div className="rounded-lg border border-slate-600 bg-blue-600 px-3 py-1.5 text-xs text-white">Search songs</div>
                <div className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-400">Paste URL</div>
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6">
            <h3 className="text-base font-semibold mb-1">
              <Editable suiKey="theme.title" def="Theme" />
            </h3>
            <p className="text-sm text-slate-400 mb-4">
              <Editable suiKey="theme.desc" def="Pick a built-in theme or create your own with a color picker." />
            </p>
            <div className="flex flex-wrap gap-2">
              {["Default", "Ocean", "Forest", "Midnight"].map((n) => (
                <div
                  key={n}
                  className={`rounded-lg border px-3 py-2 text-xs ${n === "Default" ? "border-blue-600 ring-2 ring-blue-500/30" : "border-slate-600"}`}
                >
                  {n}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6">
            <h3 className="text-base font-semibold mb-1">
              <Editable suiKey="keyboard-shortcuts.title" def="Keyboard shortcuts" />
            </h3>
            <p className="text-sm text-slate-400 mb-4">
              <Editable suiKey="keyboard-shortcuts.desc" def="Available while reading in a study session." />
            </p>
            <ul className="space-y-2 text-sm text-slate-300">
              <li>
                <kbd className="rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-xs">← →</kbd> Previous / Next page
              </li>
              <li>
                <kbd className="rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-xs">F</kbd> Search
              </li>
            </ul>
          </section>

          <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6">
            <h3 className="text-base font-semibold mb-1">Credits &amp; easter egg</h3>
            <p className="text-sm text-slate-400 mb-2 leading-relaxed">
              <Editable
                suiKey="credits"
                def="Bowl Beacon was a passion project designed by Jayden Wong as an introductory lesson in learning to code. He attributes his knowledge to his Mom and her friend for guiding him through this project, helping him develop key features, and helping him understand how this app—and coding/app development in general—works. If any issues or bugs are found, please report them through the message developer button found at the bottom of the dashboard. Happy studying and good luck at your next competition!"
                as="span"
              />
            </p>
            <p className="text-xs text-slate-500">
              Dog photo alt text: <Editable suiKey="dog-photo.alt" def="A very good boy" />
            </p>
          </section>
        </div>
        </>
        )}
      </div>

      {activeCompound && (
        <div className="fixed bottom-6 right-6 z-50 w-full max-w-md rounded-2xl border border-slate-600 bg-slate-900 p-5 shadow-2xl">
          <div className="flex justify-between items-start mb-3">
            <h4 className="text-sm font-semibold text-white">Edit: {activeCompound}</h4>
            <button type="button" className="text-slate-400 hover:text-white text-lg leading-none" onClick={() => setActiveCompound(null)} aria-label="Close">
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
