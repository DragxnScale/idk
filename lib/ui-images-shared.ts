/** Client-safe types and helpers for app UI images (no database imports). */

import type { UiPageId } from "@/lib/ui-copy-shared";

export type UiImageElement = {
  src: string;
};

export type UiImagesPayload = {
  version: 1;
  images: Record<UiPageId, Record<string, UiImageElement>>;
};

export type UiImageSlot = {
  page: UiPageId;
  k: string;
  defaultSrc: string;
  /** Fixed aspect ratio (width/height). Omit for free-form crop. */
  aspect?: number;
  /** Target export width in px. */
  exportWidth?: number;
  /** Target export height in px. Omit when aspect is free. */
  exportHeight?: number;
  label: string;
};

export const UI_IMAGE_SLOTS: UiImageSlot[] = [
  {
    page: "home",
    k: "nav.favicon",
    defaultSrc: "/favicon.png",
    aspect: 1,
    exportWidth: 56,
    exportHeight: 56,
    label: "Nav favicon",
  },
  {
    page: "settings",
    k: "dog-photo",
    defaultSrc: "/easter-egg-dog.png",
    aspect: 16 / 9,
    exportWidth: 1200,
    label: "Dog photo",
  },
  {
    page: "settings",
    k: "logo",
    defaultSrc: "/logo-gap-fill.png",
    aspect: 3 / 1,
    exportWidth: 1200,
    label: "Logo",
  },
];

export function getImageSlot(page: UiPageId, k: string): UiImageSlot | undefined {
  return UI_IMAGE_SLOTS.find((s) => s.page === page && s.k === k);
}

export function emptyImages(): Record<UiPageId, Record<string, UiImageElement>> {
  return { home: {}, dashboard: {}, session: {}, settings: {}, "session-active": {}, "exit-boss": {} };
}

export function emptyImagesPayload(): UiImagesPayload {
  return { version: 1, images: emptyImages() };
}
