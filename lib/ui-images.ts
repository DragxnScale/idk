import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import type { UiPageId } from "@/lib/ui-copy-shared";
import {
  emptyImages,
  emptyImagesPayload,
  type UiImageElement,
  type UiImagesPayload,
} from "@/lib/ui-images-shared";
import { UI_PAGE_IDS } from "@/lib/ui-copy-shared";

export * from "@/lib/ui-images-shared";

export const UI_IMAGES_KEY = "app_ui_images_json";

export function parseUiImagesPayload(raw: string | null | undefined): UiImagesPayload {
  if (!raw?.trim()) return emptyImagesPayload();
  try {
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object" || p === null) return emptyImagesPayload();
    const obj = p as Record<string, unknown>;
    if (obj.version !== 1 || !obj.images || typeof obj.images !== "object" || Array.isArray(obj.images)) {
      return emptyImagesPayload();
    }
    const images = obj.images as Record<string, unknown>;
    const out = emptyImages();
    for (const id of UI_PAGE_IDS) {
      const block = images[id];
      if (block && typeof block === "object" && !Array.isArray(block)) {
        out[id] = { ...(block as Record<string, UiImageElement>) };
      }
    }
    return { version: 1, images: out };
  } catch {
    return emptyImagesPayload();
  }
}

export async function getUiImagesPayload(): Promise<UiImagesPayload> {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, UI_IMAGES_KEY) });
  return parseUiImagesPayload(row?.value);
}

export async function setUiImagesPayload(payload: UiImagesPayload): Promise<void> {
  const now = new Date();
  const value = JSON.stringify(payload);
  const existing = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, UI_IMAGES_KEY),
  });
  if (existing) {
    await db.update(appSettings).set({ value, updatedAt: now }).where(eq(appSettings.key, UI_IMAGES_KEY));
  } else {
    await db.insert(appSettings).values({ key: UI_IMAGES_KEY, value, updatedAt: now });
  }
}

export async function patchUiImage(
  page: UiPageId,
  k: string,
  element: UiImageElement
): Promise<UiImagesPayload> {
  const payload = await getUiImagesPayload();
  const nextImages = { ...payload.images };
  const pageBlock = { ...(nextImages[page] ?? {}) };
  pageBlock[k] = element;
  nextImages[page] = pageBlock;
  const next: UiImagesPayload = { version: 1, images: nextImages };
  await setUiImagesPayload(next);
  return next;
}
