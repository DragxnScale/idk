"use client";

import { useCallback, useState } from "react";
import type { UiPageId } from "@/lib/ui-copy-shared";
import { UI_PAGE_IDS } from "@/lib/ui-copy-shared";
import { UiEditProvider } from "./UiEditProvider";
import HomeLanding from "@/app/HomeLanding";
import DashboardPage from "@/app/dashboard/page";
import StudySessionPage from "@/app/study/session/page";
import SettingsPage from "@/app/settings/page";

const PAGE_LABEL: Record<UiPageId, string> = {
  home: "Home",
  dashboard: "Dashboard",
  session: "Session start",
  settings: "Settings",
};

const PAGE_COMPONENT: Record<UiPageId, React.ComponentType> = {
  home: HomeLanding,
  dashboard: DashboardPage,
  session: StudySessionPage,
  settings: SettingsPage,
};

export function UiEditShell() {
  const [pageTab, setPageTab] = useState<UiPageId>("dashboard");

  const PageComponent = PAGE_COMPONENT[pageTab];

  const onExit = useCallback(() => {
    window.location.href = "/admin?tab=appUi";
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-gray-50 dark:bg-gray-950">
      <header className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-amber-50 px-4 py-2 dark:border-gray-800 dark:bg-amber-950/40">
        <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
          Edit mode
        </span>
        <div className="flex flex-wrap gap-1.5">
          {UI_PAGE_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setPageTab(id)}
              className={`rounded-lg px-3 py-1 text-sm transition ${
                pageTab === id
                  ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                  : "text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-800"
              }`}
            >
              {PAGE_LABEL[id]}
            </button>
          ))}
        </div>
        <p className="hidden text-xs text-gray-500 md:block">
          Right-click text or images to edit · Enter to save
        </p>
        <button
          type="button"
          onClick={onExit}
          className="ml-auto rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Exit editor
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <UiEditProvider>
          <PageComponent />
        </UiEditProvider>
      </div>
    </div>
  );
}
