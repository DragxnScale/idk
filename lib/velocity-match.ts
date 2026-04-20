// Client-safe matching helpers for the Velocity minigame.

export type VelocitySpeed = "slow" | "medium" | "fast";

/** Milliseconds per character for the typewriter, keyed by chosen speed. */
export const SPEED_MS_PER_CHAR: Record<VelocitySpeed, number> = {
  slow: 70,
  medium: 40,
  fast: 20,
};

export type VelocityQuestion =
  | {
      type: "mc";
      question: string;
      options: [string, string, string, string];
      correctIndex: 0 | 1 | 2 | 3;
      topic: string;
      explanation?: string;
    }
  | {
      type: "sa";
      question: string;
      answer: string;
      topic: string;
      explanation?: string;
    };

/** MC buzz letters, in display order. */
export const MC_LETTERS = ["W", "X", "Y", "Z"] as const;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Classic Levenshtein distance (small inputs — fine without optimisations). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "of", "in", "on", "at", "to", "from", "by", "for", "with", "as",
  "and", "or", "but", "so", "than", "then", "that", "this", "these",
  "those", "it", "its",
]);

/**
 * Returns true when the user's short answer sufficiently resembles the
 * correct answer. Strategy:
 *   1. Normalise and compare whole strings (typo-tolerant) — fast path.
 *   2. Require every content token from the correct answer to have a
 *      typo-tolerant match in the user's tokens (ignores stopwords).
 *
 * This makes "cosmic mcirowave backround" pass for "cosmic microwave
 * background" but rejects "microwave background" (missing 'cosmic').
 */
export function isShortAnswerCorrect(userAnswer: string, correct: string): boolean {
  const u = normalize(userAnswer);
  const c = normalize(correct);
  if (!u || !c) return false;
  if (u === c) return true;

  const overallDist = levenshtein(u, c);
  if (overallDist <= Math.max(1, Math.floor(c.length * 0.15))) return true;

  const userTokens = u.split(" ").filter(Boolean);
  const correctTokens = c.split(" ").filter((t) => t && !STOPWORDS.has(t));
  if (correctTokens.length === 0) {
    return overallDist <= Math.max(2, Math.floor(c.length * 0.3));
  }

  for (const tok of correctTokens) {
    const maxDist = Math.max(1, Math.floor(tok.length * 0.3));
    const matched = userTokens.some((ut) => {
      if (ut === tok) return true;
      if (Math.abs(ut.length - tok.length) > maxDist + 1) return false;
      return levenshtein(ut, tok) <= maxDist;
    });
    if (!matched) return false;
  }
  return true;
}

/**
 * Multiple-choice matching.
 *
 * Accepts:
 *   - a single letter W/X/Y/Z (case-insensitive)
 *   - verbatim option text (case-insensitive, punctuation-tolerant)
 *
 * Returns `{ correct, selectedIndex }` where selectedIndex is -1 when the
 * input does not resolve to any of the four options.
 */
export function matchMultipleChoice(
  input: string,
  options: readonly string[],
  correctIndex: number
): { correct: boolean; selectedIndex: number } {
  const trimmed = input.trim();
  if (!trimmed) return { correct: false, selectedIndex: -1 };

  if (trimmed.length === 1) {
    const letterIdx = MC_LETTERS.indexOf(trimmed.toUpperCase() as (typeof MC_LETTERS)[number]);
    if (letterIdx !== -1 && letterIdx < options.length) {
      return { correct: letterIdx === correctIndex, selectedIndex: letterIdx };
    }
  }

  const n = normalize(trimmed);
  for (let i = 0; i < options.length; i++) {
    if (normalize(options[i]) === n) {
      return { correct: i === correctIndex, selectedIndex: i };
    }
  }
  return { correct: false, selectedIndex: -1 };
}
