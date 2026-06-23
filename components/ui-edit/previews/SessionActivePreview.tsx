"use client";

/**
 * Static preview of the active study session UI for the admin UI editor.
 * No API calls — renders mock data so all SuiText nodes are accessible
 * for right-click editing.
 */

import { SuiText } from "@/components/ui-copy/UiCopyProvider";

export function SessionActivePreview() {
  return (
    <div className="h-dvh flex flex-col overflow-hidden pointer-events-auto">
      {/* Offline banner (always visible in preview so the text can be edited) */}
      <div className="flex-shrink-0 flex items-center justify-center gap-2 bg-amber-900/80 px-4 py-1.5 text-xs font-medium text-amber-200">
        <span>⚡</span>
        <span>
          <SuiText page="session-active" k="offline.banner" def="You're offline — your session is being saved locally and will sync when you reconnect." as="span" />
        </span>
        <span className="text-amber-400">
          <SuiText page="session-active" k="offline.ai-unavailable" def="· AI features unavailable offline" as="span" />
        </span>
      </div>

      {/* Top bar */}
      <header className="flex-shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-2 sm:px-6 sm:py-3 sm:gap-4 dark:border-gray-700">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-semibold">
            <SuiText page="session-active" k="header.title" def="Study session" as="span" />
          </h1>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            <SuiText page="session-active" k="header.paused-badge" def="Paused" as="span" />
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-lg border px-3 py-1.5 text-xs border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-300"
          >
            <SuiText page="session-active" k="btn.hide-notes" def="Hide Notes" as="span" />
          </button>
          <button
            type="button"
            className="rounded-lg border px-3 py-1.5 text-xs border-gray-300 dark:border-gray-600"
          >
            <SuiText page="session-active" k="btn.ai-notes" def="AI Notes" as="span" />
          </button>
          <button
            type="button"
            className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs"
          >
            <SuiText page="session-active" k="btn.pause-leave" def="Pause & leave" as="span" />
          </button>
          <button
            type="button"
            className="rounded border border-red-500/40 px-3 py-1.5 text-sm text-red-600 dark:text-red-400"
          >
            <SuiText page="exit-boss" k="btn.end-session" def="End Session" as="span" />
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
        {/* Timer sidebar */}
        <aside className="flex-shrink-0 border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-700 p-4 sm:p-6 lg:w-64">
          <div className="text-center">
            <p className="text-4xl font-bold tabular-nums">25:00</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Time goal · 30 min</p>
          </div>
          <div className="mt-4 text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <p>
              <SuiText page="session-active" k="sidebar.pages-visited" def="Pages visited:" as="span" />{" "}
              12
            </p>
            <p className="text-amber-600 dark:text-amber-400 animate-pulse">
              <SuiText page="session-active" k="sidebar.loading-doc" def="Loading document…" as="span" />
            </p>
            <p>
              <SuiText page="session-active" k="sidebar.stay-on-tab" def="Stay on this tab to keep the timer running." as="span" />
            </p>
          </div>
        </aside>

        {/* Main content placeholder */}
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-gray-600 p-8 text-center">
          PDF reader area
          <br />
          <span className="text-xs">(right-click the labels above and in the sidebar to edit)</span>
        </div>
      </div>

      {/* Unfinished session gate (shown below as a separate panel) */}
      <div className="border-t border-dashed border-gray-300 dark:border-gray-700 p-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Unfinished session gate preview
        </p>
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 max-w-lg dark:border-amber-700 dark:bg-amber-900/20 shadow-lg">
          <h2 className="text-lg font-semibold text-amber-800 dark:text-amber-300 mb-2">
            <SuiText page="session-active" k="gate.title" def="You have an unfinished session" as="span" />
          </h2>
          <p className="text-sm text-amber-700 dark:text-amber-400 mb-1">
            <span className="font-medium text-amber-900 dark:text-amber-200">
              <SuiText page="session-active" k="gate.paused" def="Paused — pick up where you left off." as="span" />
            </span>
            {" "}30 min goal · 12m studied · page 45
          </p>
          <p className="text-sm text-amber-600 dark:text-amber-500 mb-5">
            <SuiText page="session-active" k="gate.hint" def="Resume opens your session. To end it, open the session and use End session (Boss Beacons if enabled)." as="span" />
          </p>
          <button
            type="button"
            className="w-full rounded-lg bg-amber-600 px-4 py-3 text-sm font-medium text-white"
          >
            <SuiText page="session-active" k="gate.btn.resume" def="Resume session" as="span" />
          </button>
        </div>
        <div className="mt-4">
          <span className="text-sm underline underline-offset-4 text-gray-500">
            <SuiText page="session-active" k="gate.link.dashboard" def="Back to dashboard" as="span" />
          </span>
        </div>
      </div>
    </div>
  );
}
