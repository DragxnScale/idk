import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";

export const SETTINGS_UI_KEY = "settings_ui_json";

export type SettingsUiElement = {
  text?: string;
  fontFamily?: string;
  fontSize?: string;
  color?: string;
  fontWeight?: string;
  textDecoration?: string;
};

export type SettingsUiPayload = { version: 1; elements: Record<string, SettingsUiElement> };

export function parseSettingsUiPayload(raw: string | null | undefined): SettingsUiPayload {
  if (!raw?.trim()) return { version: 1, elements: {} };
  try {
    const p = JSON.parse(raw) as unknown;
    if (p && typeof p === "object" && p !== null && "elements" in p) {
      const el = (p as { elements?: unknown }).elements;
      if (el && typeof el === "object" && !Array.isArray(el)) {
        return { version: 1, elements: el as Record<string, SettingsUiElement> };
      }
    }
  } catch {
    /* ignore */
  }
  return { version: 1, elements: {} };
}

export async function getSettingsUiPayload(): Promise<SettingsUiPayload> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, SETTINGS_UI_KEY),
  });
  return parseSettingsUiPayload(row?.value);
}

export async function setSettingsUiPayload(payload: SettingsUiPayload): Promise<void> {
  const now = new Date();
  const value = JSON.stringify(payload);
  const existing = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, SETTINGS_UI_KEY),
  });
  if (existing) {
    await db.update(appSettings).set({ value, updatedAt: now }).where(eq(appSettings.key, SETTINGS_UI_KEY));
  } else {
    await db.insert(appSettings).values({ key: SETTINGS_UI_KEY, value, updatedAt: now });
  }
}
