// Hardcoded settings page layout spec, keyed on the two user toggles that
// change how much empty space there is on the page.
//
// The settings page has 3 regions:
//   * TOP    — full-width cards above the 2-column flow (e.g. daily goals)
//   * LEFT   — half-width cards in the left column (top-to-bottom)
//   * RIGHT  — half-width cards in the right column (top-to-bottom)
//   * BOTTOM — full-width cards below the 2-column flow
//
// Each layout state defines which card IDs appear in which region, and in
// which order. The settings page consumes this spec directly; there is no
// runtime config or admin editor.

export type LayoutStateKey =
  | "cacheOff_breaksOff"
  | "cacheOff_breaksOn"
  | "cacheOn_breaksOff"
  | "cacheOn_breaksOn";

export interface LayoutSpec {
  top:    string[];
  left:   string[];
  right:  string[];
  bottom: string[];
}

// ── Hardcoded layouts ────────────────────────────────────────────────────────

const COMMON_TOP    = ["daily-goals"];
const COMMON_BOTTOM = ["focus-music", "theme", "keyboard-shortcuts"];

export const LAYOUTS: Record<LayoutStateKey, LayoutSpec> = {
  // Cache OFF + Breaks OFF — biggest empty space on the right, fill with dog + credits.
  // Right column: textbook display → upload storage → dog → credits.
  cacheOff_breaksOff: {
    top: COMMON_TOP,
    left:  ["account", "session-defaults", "study-breaks", "pdf-cache", "exit-password"],
    right: ["textbook-size", "upload-storage", "dog-photo", "credits"],
    bottom: COMMON_BOTTOM,
  },

  // Cache OFF + Breaks ON — breaks panel is tall, so move session-defaults to
  // the right column. Right column: upload storage → session defaults → dog → credits.
  cacheOff_breaksOn: {
    top: COMMON_TOP,
    left:  ["account", "study-breaks", "textbook-size", "pdf-cache", "exit-password"],
    right: ["upload-storage", "session-defaults", "dog-photo", "credits"],
    bottom: COMMON_BOTTOM,
  },

  // Cache ON + Breaks OFF — session-defaults + textbook-size moved to right,
  // exit-password moved to left.
  cacheOn_breaksOff: {
    top: COMMON_TOP,
    left:  ["account", "exit-password", "upload-storage"],
    right: ["study-breaks", "session-defaults", "textbook-size", "pdf-cache"],
    bottom: COMMON_BOTTOM,
  },

  // Cache ON + Breaks ON — small gap, fill with the logo above the credits text.
  cacheOn_breaksOn: {
    top: COMMON_TOP,
    left:  ["account", "session-defaults", "pdf-cache", "exit-password"],
    right: ["study-breaks", "textbook-size", "upload-storage", "logo", "credits"],
    bottom: COMMON_BOTTOM,
  },
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
