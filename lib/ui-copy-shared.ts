/** Client-safe types and helpers for app UI copy (no database imports). */

export type UiCopyElement = {
  text?: string;
  fontFamily?: string;
  fontSize?: string;
  color?: string;
  fontWeight?: string;
  textDecoration?: string;
};

export const UI_PAGE_IDS = ["home", "dashboard", "session", "settings"] as const;
export type UiPageId = (typeof UI_PAGE_IDS)[number];

export type UiCopyPayload = {
  version: 2;
  pages: Record<UiPageId, Record<string, UiCopyElement>>;
};

export function emptyPages(): Record<UiPageId, Record<string, UiCopyElement>> {
  return { home: {}, dashboard: {}, session: {}, settings: {} };
}

export function emptyPayload(): UiCopyPayload {
  return { version: 2, pages: emptyPages() };
}

function isUiPageId(s: string): s is UiPageId {
  return (UI_PAGE_IDS as readonly string[]).includes(s);
}

export function ensureAllPages(
  partial: Partial<Record<UiPageId, Record<string, UiCopyElement>>>
): Record<UiPageId, Record<string, UiCopyElement>> {
  return {
    home: partial.home ?? {},
    dashboard: partial.dashboard ?? {},
    session: partial.session ?? {},
    settings: partial.settings ?? {},
  };
}

export function compoundKey(page: UiPageId, k: string): string {
  return `${page}|${k}`;
}

export function parseCompoundKey(compound: string): { page: UiPageId; k: string } | null {
  const i = compound.indexOf("|");
  if (i <= 0) return null;
  const page = compound.slice(0, i);
  const k = compound.slice(i + 1);
  if (!isUiPageId(page) || !k) return null;
  return { page, k };
}
