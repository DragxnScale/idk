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
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
