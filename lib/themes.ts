export interface ThemeColors {
  id: string;
  name: string;
  primary: string;      // main accent
  primaryFg: string;    // text on primary
  accent: string;       // secondary accent
  bg: string;           // page background
  card: string;         // card background
  cardBorder: string;   // card border
  text: string;         // main text
  textMuted: string;    // muted text
  custom?: boolean;     // true for user-created themes
}

export const THEMES: ThemeColors[] = [
  {
    id: "default",
    name: "Default",
    primary: "#000000",
    primaryFg: "#ffffff",
    accent: "#3b82f6",
    bg: "#fafafa",
    card: "#ffffff",
    cardBorder: "#e5e7eb",
    text: "#0a0a0a",
    textMuted: "#6b7280",
  },
  {
    id: "ocean",
    name: "Ocean",
    primary: "#0ea5e9",
    primaryFg: "#ffffff",
    accent: "#06b6d4",
    bg: "#f0f9ff",
    card: "#ffffff",
    cardBorder: "#bae6fd",
    text: "#0c4a6e",
    textMuted: "#0369a1",
  },
  {
    id: "forest",
    name: "Forest",
    primary: "#16a34a",
    primaryFg: "#ffffff",
    accent: "#22c55e",
    bg: "#f0fdf4",
    card: "#ffffff",
    cardBorder: "#bbf7d0",
    text: "#14532d",
    textMuted: "#166534",
  },
  {
    id: "sunset",
    name: "Sunset",
    primary: "#ea580c",
    primaryFg: "#ffffff",
    accent: "#f97316",
    bg: "#fff7ed",
    card: "#ffffff",
    cardBorder: "#fed7aa",
    text: "#7c2d12",
    textMuted: "#9a3412",
  },
  {
    id: "lavender",
    name: "Lavender",
    primary: "#7c3aed",
    primaryFg: "#ffffff",
    accent: "#8b5cf6",
    bg: "#f5f3ff",
    card: "#ffffff",
    cardBorder: "#ddd6fe",
    text: "#3b0764",
    textMuted: "#5b21b6",
  },
  {
    id: "rose",
    name: "Rose",
    primary: "#e11d48",
    primaryFg: "#ffffff",
    accent: "#fb7185",
    bg: "#fff1f2",
    card: "#ffffff",
    cardBorder: "#fecdd3",
    text: "#881337",
    textMuted: "#be123c",
  },
  {
    id: "midnight",
    name: "Midnight",
    primary: "#e2e8f0",
    primaryFg: "#0f172a",
    accent: "#60a5fa",
    bg: "#0f172a",
    card: "#1e293b",
    cardBorder: "#334155",
    text: "#e2e8f0",
    textMuted: "#94a3b8",
  },
  {
    id: "sepia",
    name: "Sepia",
    primary: "#92400e",
    primaryFg: "#fefce8",
    accent: "#b45309",
    bg: "#fefce8",
    card: "#fffbeb",
    cardBorder: "#fde68a",
    text: "#451a03",
    textMuted: "#78350f",
  },
];

export function getThemeById(id: string | null): ThemeColors {
  return THEMES.find((t) => t.id === id) ?? getCustomThemes().find((t) => t.id === id) ?? THEMES[0];
}

// ── Custom theme utilities ────────────────────────────────────────────────────

const CUSTOM_KEY = "bowlbeacon-custom-themes";

/** Relative luminance (0 = black, 1 = white) */
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Given a bg hex, lighten or darken it by `amount` (0–1) toward white/black */
function shiftColor(hex: string, amount: number, toward: "white" | "black"): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const target = toward === "white" ? 255 : 0;
  const mix = (c: number) => Math.round(c + (target - c) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Derive a full ThemeColors from the three user-chosen colors.
 * The user picks: primary (button color), accent (highlight), background.
 */
export function buildCustomTheme(
  id: string,
  name: string,
  primary: string,
  accent: string,
  bg: string
): ThemeColors {
  const bgLum = luminance(bg);
  const isDark = bgLum < 0.3;
  const primaryFg = luminance(primary) > 0.35 ? "#0a0a0a" : "#ffffff";
  const card = isDark ? shiftColor(bg, 0.06, "white") : shiftColor(bg, 0.03, "black");
  const cardBorder = isDark ? shiftColor(bg, 0.15, "white") : shiftColor(bg, 0.12, "black");
  const text = isDark ? "#f0f0f0" : "#0a0a0a";
  const textMuted = isDark ? "#9ca3af" : "#6b7280";
  return { id, name, primary, primaryFg, accent, bg, card, cardBorder, text, textMuted, custom: true };
}

export function getCustomThemes(): ThemeColors[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveCustomThemes(themes: ThemeColors[]) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(themes));
}

/** Apply a theme's CSS variables directly to the document root (for custom themes). */
export function applyThemeCssVars(t: ThemeColors) {
  const el = document.documentElement;
  el.style.setProperty("--theme-primary", t.primary);
  el.style.setProperty("--theme-primary-fg", t.primaryFg);
  el.style.setProperty("--theme-accent", t.accent);
  el.style.setProperty("--background", t.bg);
  el.style.setProperty("--foreground", t.text);
}

/** Remove inline CSS vars (used when switching away from a custom theme). */
export function clearThemeCssVars() {
  const el = document.documentElement;
  ["--theme-primary", "--theme-primary-fg", "--theme-accent", "--background", "--foreground"]
    .forEach((v) => el.style.removeProperty(v));
}
