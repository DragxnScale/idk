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
      roundType: "tossup" | "bonus";
      pairId: string;
      question: string;
      options: [string, string, string, string];
      correctIndex: 0 | 1 | 2 | 3;
      topic: string;
      explanation?: string;
      /** 1-indexed page this concept was sourced from. */
      pageIndex?: number;
    }
  | {
      type: "sa";
      roundType: "tossup" | "bonus";
      pairId: string;
      question: string;
      answer: string;
      /** Extra strings the grader should accept as correct — synonyms,
       *  more-specific textbook names, common acronym/expansion pairs, etc. */
      acceptedAnswers?: string[];
      topic: string;
      explanation?: string;
      /** 1-indexed page this concept was sourced from. */
      pageIndex?: number;
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
 * Reduce a token to a loose morphological stem so adjective/noun/adverb
 * variants of the same root ("spontaneous" / "spontaneity" / "spontaneously")
 * collapse to the same key. This is deliberately a cheap, English-biased
 * heuristic — not a real stemmer — because the accompanying Levenshtein
 * tolerance already handles typos. The goal is to stop the matcher from
 * treating morphological variants as completely different words when the
 * edit distance between them happens to exceed the per-token tolerance
 * (e.g. "spontaneous" → "spontaneity" is 4 edits at 11 chars = 36%,
 * which trips the 30% cap even though they're plainly the same concept).
 */
function morphStem(token: string): string {
  let t = token;
  // Strip common English suffixes in order, longest first.
  const suffixes = [
    "isation",
    "ization",
    "iously",
    "eously",
    "ations",
    "ments",
    "ities",
    "ities",
    "ation",
    "ising",
    "izing",
    "ously",
    "ised",
    "ized",
    "ious",
    "eous",
    "ally",
    "able",
    "ible",
    "ment",
    "ness",
    "ity",
    "ise",
    "ize",
    "ing",
    "ate",
    "ous",
    "ors",
    "ers",
    "ic",
    "al",
    "ly",
    "ed",
    "es",
    "or",
    "er",
    "s",
    "y",
    "e",
  ];
  for (const suf of suffixes) {
    if (t.length > suf.length + 2 && t.endsWith(suf)) {
      t = t.slice(0, -suf.length);
      break;
    }
  }
  // Collapse trailing doubled consonants ("stopp" → "stop").
  if (t.length > 3 && t[t.length - 1] === t[t.length - 2]) {
    t = t.slice(0, -1);
  }
  return t;
}

/**
 * Returns true when the user's short answer sufficiently resembles the
 * correct answer. Strategy:
 *   1. Normalise and compare whole strings (typo-tolerant) — fast path.
 *   2. Require every content token from the correct answer to have a
 *      typo-tolerant match in the user's tokens (ignores stopwords).
 *      Each required token also has a morphological-stem fallback, so
 *      "spontaneous" matches "spontaneity", "oxidise" matches "oxidation",
 *      etc., without needing the AI grader.
 *
 * This makes "cosmic mcirowave backround" pass for "cosmic microwave
 * background" but rejects "microwave background" (missing 'cosmic').
 */
export function isShortAnswerCorrect(userAnswer: string, correct: string): boolean {
  const u = normalize(userAnswer);
  const c = normalize(correct);
  if (!u || !c) return false;
  if (u === c) return true;

  // Bumped the overall tolerance from 15% → 20% so two-character
  // transposition-style typos on ~11-char words ("spontenaity" for
  // "spontaneity", edit distance 2) pass the fast path instead of
  // falling through to the AI grader.
  const overallDist = levenshtein(u, c);
  if (overallDist <= Math.max(1, Math.floor(c.length * 0.2))) return true;

  const userTokens = u.split(" ").filter(Boolean);
  const correctTokens = c.split(" ").filter((t) => t && !STOPWORDS.has(t));
  if (correctTokens.length === 0) {
    return overallDist <= Math.max(2, Math.floor(c.length * 0.3));
  }

  const userStems = userTokens.map(morphStem);
  for (const tok of correctTokens) {
    const maxDist = Math.max(1, Math.floor(tok.length * 0.3));
    const tokStem = morphStem(tok);
    const matched = userTokens.some((ut, idx) => {
      if (ut === tok) return true;
      if (Math.abs(ut.length - tok.length) <= maxDist + 1 && levenshtein(ut, tok) <= maxDist) {
        return true;
      }
      // Morphological fallback: compare stems with a looser edit budget
      // (50% of the stem length, floored at 1) so that e.g.
      // "spontaneous" (stem "spontan") and "spontaneity" (stem "spontan")
      // both collapse to the same root and match.
      const us = userStems[idx];
      if (!us || !tokStem) return false;
      if (us === tokStem) return true;
      const stemMax = Math.max(1, Math.floor(tokStem.length * 0.5));
      if (Math.abs(us.length - tokStem.length) > stemMax + 1) return false;
      return levenshtein(us, tokStem) <= stemMax;
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
