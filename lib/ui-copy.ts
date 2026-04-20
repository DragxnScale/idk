import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import {
  emptyPages,
  emptyPayload,
  type UiCopyElement,
  type UiCopyPayload,
  UI_PAGE_IDS,
} from "@/lib/ui-copy-shared";

export * from "@/lib/ui-copy-shared";

/** New canonical storage key (v2 multi-page payload). */
export const UI_COPY_KEY = "app_ui_copy_json";

/** Legacy single-page Settings overrides (v1); merged on read until superseded per-key by v2. */
export const LEGACY_SETTINGS_UI_KEY = "settings_ui_json";

/** Parse v1 `{ version: 1, elements }` from any row. */
export function parseLegacySettingsElements(raw: string | null | undefined): Record<string, UiCopyElement> {
  if (!raw?.trim()) return {};
  try {
    const p = JSON.parse(raw) as unknown;
    if (p && typeof p === "object" && p !== null && "elements" in p) {
      const el = (p as { elements?: unknown }).elements;
      if (el && typeof el === "object" && !Array.isArray(el)) {
        return el as Record<string, UiCopyElement>;
      }
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** Parse stored `app_ui_copy_json`: v2 pages, or v1 elements migrated into `settings`. */
export function parseUiCopyPayloadFromAppRow(raw: string | null | undefined): UiCopyPayload {
  if (!raw?.trim()) return emptyPayload();
  try {
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object" || p === null) return emptyPayload();

    const obj = p as Record<string, unknown>;
    if (obj.version === 2 && obj.pages && typeof obj.pages === "object" && !Array.isArray(obj.pages)) {
      const pages = obj.pages as Record<string, unknown>;
      const out = emptyPages();
      for (const id of UI_PAGE_IDS) {
        const block = pages[id];
        if (block && typeof block === "object" && !Array.isArray(block)) {
          out[id] = { ...(block as Record<string, UiCopyElement>) };
        }
      }
      return { version: 2, pages: out };
    }

    if ("elements" in obj) {
      const els = obj.elements;
      if (els && typeof els === "object" && !Array.isArray(els)) {
        return {
          version: 2,
          pages: { ...emptyPages(), settings: els as Record<string, UiCopyElement> },
        };
      }
    }
  } catch {
    /* ignore */
  }
  return emptyPayload();
}

function mergeLegacyIntoSettings(base: UiCopyPayload, legacy: Record<string, UiCopyElement>): UiCopyPayload {
  if (Object.keys(legacy).length === 0) return base;
  const nextSettings = { ...base.pages.settings };
  for (const [k, v] of Object.entries(legacy)) {
    if (nextSettings[k] === undefined) nextSettings[k] = v;
  }
  return { ...base, pages: { ...base.pages, settings: nextSettings } };
}

export async function getUiCopyPayload(): Promise<UiCopyPayload> {
  const [appRow, legacyRow] = await Promise.all([
    db.query.appSettings.findFirst({ where: eq(appSettings.key, UI_COPY_KEY) }),
    db.query.appSettings.findFirst({ where: eq(appSettings.key, LEGACY_SETTINGS_UI_KEY) }),
  ]);
  const fromApp = parseUiCopyPayloadFromAppRow(appRow?.value);
  const legacyElements = parseLegacySettingsElements(legacyRow?.value);
  return mergeLegacyIntoSettings(fromApp, legacyElements);
}

export async function setUiCopyPayload(payload: UiCopyPayload): Promise<void> {
  const now = new Date();
  const value = JSON.stringify(payload);
  const existing = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, UI_COPY_KEY),
  });
  if (existing) {
    await db.update(appSettings).set({ value, updatedAt: now }).where(eq(appSettings.key, UI_COPY_KEY));
  } else {
    await db.insert(appSettings).values({ key: UI_COPY_KEY, value, updatedAt: now });
  }
}
