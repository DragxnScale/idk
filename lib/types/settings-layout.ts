// Shared types for the owner-configurable settings page layout.

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

export interface SettingsLayoutConfig {
  version: number;
  cards: CardConfig[];
}

// ── Default definitions ──────────────────────────────────────────────────────

export const CARD_DEFAULTS: CardConfig[] = [
  { id: "daily-goals",          visible: true, span: 2, order:  0, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "account",              visible: true, span: 1, order:  1, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "session-defaults",     visible: true, span: 1, order:  2, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "study-breaks",         visible: true, span: 1, order:  3, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "textbook-size",        visible: true, span: 1, order:  4, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "pdf-cache",            visible: true, span: 1, order:  5, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "upload-storage",       visible: true, span: 1, order:  6, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "exit-password",        visible: true, span: 1, order:  7, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "focus-music",          visible: true, span: 2, order:  8, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "theme",                visible: true, span: 2, order:  9, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
  { id: "keyboard-shortcuts",   visible: true, span: 2, order: 10, titleText: null, titleSize: "base", descText: null, descSize: "sm", fontFamily: "inherit" },
];

export const DEFAULT_CONFIG: SettingsLayoutConfig = {
  version: 1,
  cards: CARD_DEFAULTS,
};

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
  "focus-music":        "Focus music",
  "theme":              "Theme",
  "keyboard-shortcuts": "Keyboard shortcuts",
};
