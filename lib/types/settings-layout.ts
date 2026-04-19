// Shared types for the owner-configurable settings page layout.
//
// v2 introduces 4 independently configurable layout states, keyed by the
// (pdfCacheEnabled, pomodoroEnabled) tuple. The settings page picks the
// appropriate state at render time, and the admin editor lets the owner
// customise each state individually.

export type FontFamily = "inherit" | "mono" | "serif";
export type TitleSize  = "xs" | "sm" | "base" | "lg" | "xl";
export type TextSize   = "xs" | "sm" | "base";
export type CardSpan   = 1 | 2; // 1 = half-width column, 2 = full-width

export interface CardConfig {
  /** Stable identifier that maps to a section in settings/page.tsx */
  id: string;
  /** Whether this card is rendered at all */
  visible: boolean;
  /** 1 = half-width (one column), 2 = full-width (spans both columns) */
  span: CardSpan;
  /** Render order (0-based, ascending) */
  order: number;
  /** Override the section heading text; null = keep default */
  titleText: string | null;
  /** Tailwind size token for the heading */
  titleSize: TitleSize;
  /** Override the section description paragraph; null = keep default */
  descText: string | null;
  /** Tailwind size token for description text */
  descSize: TextSize;
  /** CSS font-family override */
  fontFamily: FontFamily;
}

/**
 * The four independently configurable states, keyed by:
 *   (pdfCacheEnabled, pomodoroEnabled)
 *
 * - cacheOff_breaksOff
 * - cacheOff_breaksOn
 * - cacheOn_breaksOff
 * - cacheOn_breaksOn
 */
export type LayoutStateKey =
  | "cacheOff_breaksOff"
  | "cacheOff_breaksOn"
  | "cacheOn_breaksOff"
  | "cacheOn_breaksOn";

export const LAYOUT_STATE_KEYS: LayoutStateKey[] = [
  "cacheOff_breaksOff",
  "cacheOff_breaksOn",
  "cacheOn_breaksOff",
  "cacheOn_breaksOn",
];

export const LAYOUT_STATE_LABELS: Record<LayoutStateKey, string> = {
  cacheOff_breaksOff: "Cache OFF · Breaks OFF",
  cacheOff_breaksOn:  "Cache OFF · Breaks ON",
  cacheOn_breaksOff:  "Cache ON · Breaks OFF",
  cacheOn_breaksOn:   "Cache ON · Breaks ON",
};

export interface SettingsLayoutConfig {
  version: number;
  /** Per-state cards. Every LayoutStateKey must be populated. */
  states: Record<LayoutStateKey, CardConfig[]>;
}

// ── Default definitions ──────────────────────────────────────────────────────

/** Base card list — used as the foundation when building each state's default. */
const BASE_CARDS: CardConfig[] = [
  { id: "daily-goals",          visible: true, span: 2, order:  0, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "account",              visible: true, span: 1, order:  1, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "session-defaults",     visible: true, span: 1, order:  2, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "study-breaks",         visible: true, span: 1, order:  3, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "textbook-size",        visible: true, span: 1, order:  4, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "pdf-cache",            visible: true, span: 1, order:  5, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "upload-storage",       visible: true, span: 1, order:  6, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "exit-password",        visible: true, span: 1, order:  7, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "dog-photo",            visible: true, span: 1, order:  8, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "credits",              visible: true, span: 1, order:  9, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "focus-music",          visible: true, span: 2, order: 10, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "theme",                visible: true, span: 2, order: 11, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "keyboard-shortcuts",   visible: true, span: 2, order: 12, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
];

/** Ordered IDs of all known cards (used for consistency checks) */
export const ALL_CARD_IDS: string[] = BASE_CARDS.map((c) => c.id);

/** Shallow clone helper */
function cloneCards(src: CardConfig[]): CardConfig[] {
  return src.map((c) => ({ ...c }));
}

/** Apply a set of patches (by id) on top of a base clone and re-sequence orders. */
function withPatches(patches: Record<string, Partial<CardConfig>>): CardConfig[] {
  const cards = cloneCards(BASE_CARDS);
  for (const c of cards) {
    const p = patches[c.id];
    if (p) Object.assign(c, p);
  }
  // Re-sequence order to the numeric order already on the card (no gaps, stable)
  cards.sort((a, b) => a.order - b.order);
  cards.forEach((c, i) => (c.order = i));
  return cards;
}

// ── Per-state defaults ───────────────────────────────────────────────────────
//
// State rules driven by user feedback:
//  - cache OFF + breaks OFF → storage & pdf-cache on the left, show dog + credits to fill the right gap
//  - cache OFF + breaks ON  → pdf-cache on the left, show dog + credits
//  - cache ON  + breaks OFF → hide dog + credits (no gap to fill)
//  - cache ON  + breaks ON  → show only credits text (no dog), no gap

// cache OFF, breaks OFF — biggest empty space on the right, fill with dog + credits
const STATE_CACHE_OFF_BREAKS_OFF: CardConfig[] = withPatches({
  // left column (odd orders): account, session-defaults, pdf-cache, upload-storage
  "account":         { order: 1 },
  "session-defaults":{ order: 3 },
  "pdf-cache":       { order: 5 },
  "upload-storage":  { order: 7 },
  // right column (even orders): study-breaks (off/hidden visually?), textbook-size, exit-password, dog, credits
  "study-breaks":    { order: 2 },
  "textbook-size":   { order: 4 },
  "exit-password":   { order: 6 },
  "dog-photo":       { order: 8,  visible: true },
  "credits":         { order: 9,  visible: true },
});

// cache OFF, breaks ON — pdf-cache on the left to fill gap, dog + credits on right
const STATE_CACHE_OFF_BREAKS_ON: CardConfig[] = withPatches({
  "account":         { order: 1 },
  "session-defaults":{ order: 3 },
  "pdf-cache":       { order: 5 }, // left column
  "upload-storage":  { order: 7 },
  "study-breaks":    { order: 2 }, // right column
  "textbook-size":   { order: 4 },
  "exit-password":   { order: 6 },
  "dog-photo":       { order: 8,  visible: true },
  "credits":         { order: 9,  visible: true },
});

// cache ON, breaks OFF — no gap, hide dog + credits
const STATE_CACHE_ON_BREAKS_OFF: CardConfig[] = withPatches({
  "dog-photo": { visible: false },
  "credits":   { visible: false },
});

// cache ON, breaks ON — minor gap, show credits text only (no dog)
const STATE_CACHE_ON_BREAKS_ON: CardConfig[] = withPatches({
  "dog-photo": { visible: false },
  "credits":   { visible: true },
});

export const DEFAULT_CONFIG: SettingsLayoutConfig = {
  version: 2,
  states: {
    cacheOff_breaksOff: STATE_CACHE_OFF_BREAKS_OFF,
    cacheOff_breaksOn:  STATE_CACHE_OFF_BREAKS_ON,
    cacheOn_breaksOff:  STATE_CACHE_ON_BREAKS_OFF,
    cacheOn_breaksOn:   STATE_CACHE_ON_BREAKS_ON,
  },
};

// ── Migration / merge helpers ────────────────────────────────────────────────

/**
 * v1 config shape (single `cards` array). Kept for migration only.
 */
interface LegacyV1Config {
  version?: number;
  cards?: CardConfig[];
}

function mergeCardList(loaded: CardConfig[] | undefined, fallback: CardConfig[]): CardConfig[] {
  if (!loaded || loaded.length === 0) return cloneCards(fallback);
  const byId = new Map(loaded.map((c) => [c.id, c]));
  const maxOrder = loaded.reduce((m, c) => Math.max(m, c.order), -1);
  const merged: CardConfig[] = cloneCards(loaded);
  let nextOrder = maxOrder + 1;
  for (const d of BASE_CARDS) {
    if (!byId.has(d.id)) merged.push({ ...d, order: nextOrder++ });
  }
  return merged;
}

/**
 * Merges a loaded config with DEFAULT_CONFIG so any new cards or states
 * added in a later app version are present even if the DB has an older
 * saved config.
 *
 * Handles three shapes:
 *   - Missing / null → DEFAULT_CONFIG
 *   - Legacy v1 { version, cards } → use `cards` as the starting point for every state
 *   - v2 { version, states } → per-state merge against BASE_CARDS
 */
export function mergeWithDefaults(
  loaded: SettingsLayoutConfig | LegacyV1Config | null | undefined,
): SettingsLayoutConfig {
  if (!loaded) return DEFAULT_CONFIG;

  // Legacy v1 migration: seed every state with the old single cards list
  if ("cards" in loaded && loaded.cards && !("states" in loaded)) {
    const legacyCards = mergeCardList(loaded.cards, BASE_CARDS);
    return {
      version: 2,
      states: {
        cacheOff_breaksOff: cloneCards(legacyCards),
        cacheOff_breaksOn:  cloneCards(legacyCards),
        cacheOn_breaksOff:  cloneCards(legacyCards),
        cacheOn_breaksOn:   cloneCards(legacyCards),
      },
    };
  }

  // v2 per-state merge
  const loadedV2 = loaded as SettingsLayoutConfig;
  const states = {} as Record<LayoutStateKey, CardConfig[]>;
  for (const key of LAYOUT_STATE_KEYS) {
    const src = loadedV2.states?.[key];
    const fallback = DEFAULT_CONFIG.states[key];
    states[key] = mergeCardList(src, fallback);
  }
  return { version: 2, states };
}

/** Human-readable labels shown in the admin editor */
export const CARD_LABELS: Record<string, string> = {
  "daily-goals":        "Daily goals",
  "account":            "Account",
  "session-defaults":   "Session defaults",
  "study-breaks":       "Study breaks",
  "textbook-size":      "Textbook display size",
  "pdf-cache":          "Offline PDF cache",
  "upload-storage":     "Upload storage",
  "exit-password":      "Exit password",
  "dog-photo":          "Dog photo (easter egg)",
  "credits":            "Credits text (easter egg)",
  "focus-music":        "Focus music",
  "theme":              "Theme",
  "keyboard-shortcuts": "Keyboard shortcuts",
};

/** Resolve the runtime LayoutStateKey from the two user toggles */
export function resolveLayoutStateKey(
  pdfCacheEnabled: boolean,
  pomodoroEnabled: boolean,
): LayoutStateKey {
  if (!pdfCacheEnabled && !pomodoroEnabled) return "cacheOff_breaksOff";
  if (!pdfCacheEnabled && pomodoroEnabled)  return "cacheOff_breaksOn";
  if (pdfCacheEnabled  && !pomodoroEnabled) return "cacheOn_breaksOff";
  return "cacheOn_breaksOn";
}
