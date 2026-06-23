/**
 * Shared velocity question bank helpers — used by Velocity generation and
 * Boss Beacons exit gate.
 */
import { and, eq, inArray, lt, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  documentQuizQuestions,
  velocityQuestionBank,
} from "@/lib/db/schema";
import { EXIT_BOSS_COUNT } from "@/lib/exit-bosses";
import type { VelocityQuestion } from "@/lib/velocity-match";

export const BAD_QUESTION_REPORT_THRESHOLD = 1;

const BANNED_STEM_PATTERNS: RegExp[] = [
  /\b(?:the|this|that)\s+(?:example|passage|text|reading|book|chapter|section|article|paper|author|figure|diagram|table|graph|image|illustration|photograph|experiment|scenario|problem|case)\b/i,
  /\bas\s+(?:mentioned|described|discussed|shown|noted|stated|explained|given|seen)\b/i,
  /\b(?:mentioned|described|discussed|shown|noted|stated|explained)\s+(?:above|below|in\s+the\s+text|in\s+the\s+reading|previously)\b/i,
  /\bthe\s+\w+\s+(?:ideas|points|reasons|factors|steps|stages|types|kinds|categories|examples|principles|laws|properties|features|characteristics)\s+(?:named|listed|mentioned|given|described|discussed|shown)\b/i,
  /\bthe\s+\w+\s+example\b/i,
  /\b(?:above|below)\b.*\b(?:mentioned|listed|described|discussed|shown|given|stated|defined)\b/i,
];

const TEXTBOOK_DATAPOINT_STEM_PATTERNS: RegExp[] = [
  /\bat\s+t\s*=\s*\d/i,
  /\bat\s+\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds|min|mins|minute|minutes|h|hr|hrs|hour|hours|ms)\b/i,
  /\bafter\s+\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds|min|mins|minute|minutes|h|hr|hrs|hour|hours|ms)\b/i,
  /\b(?:obtained|measured|reached|found|calculated|determined)\s+at\s+\d/i,
  /\bin\s+this\s+(?:experiment|reaction|trial|run|study)\b/i,
  /\bfor\s+the\s+(?:reaction|experiment|graph|curve|plot|table|data\s*set)\s+(?:shown|given|above|below|presented|described)\b/i,
  /\bslope\s+of\s+the\s+tangent\s+(?:to|at|on|for)\b/i,
  /\bwhat\s+(?:instantaneous|initial|average)\s+rate\b/i,
  /\brate\s+of\s+(?:disappearance|appearance|production|consumption|formation)\s+of\b/i,
  /\b(?:rate|concentration|pH|temperature|pressure|volume|mass|yield|equilibrium\s+constant)\s+of\s+(?:solution|sample|reaction|compound|mixture)\s+[A-Z]\b/i,
  /\b(?:equilibrium\s+constant|rate\s+constant|k\s+value|Ka|Kb|Kc|Kp|Ksp)\s+(?:for|of)\s+(?:this|the)\s+(?:reaction|system|experiment|trial)\b/i,
];

const TEXTBOOK_DATAPOINT_ANSWER =
  /^\s*[-+]?\d+(?:\.\d+)?\s*(?:[×x*eE]\s*10?\s*\^?\s*[-+]?\d+)?\s*(?:mol\/L·s|mol\/L\*s|mol\/L\s*s|mol\s*\/\s*L·s|mol\/L|M\/s|\/s|s\^?-?1)\s*$/i;

const SCI_NOTATION_SHAPE =
  /\d(?:\.\d+)?\s*(?:[×x*eE]\s*10?\s*\^?\s*[-+]?\d|e[-+]?\d)/i;

export function sourceKeyFromDocJson(
  documentJson: string | null | undefined
): string | null {
  if (!documentJson) return null;
  try {
    const doc = JSON.parse(documentJson) as {
      type?: string;
      documentId?: string;
    };
    if (!doc.documentId) return null;
    if (doc.type === "textbook") return `textbook:${doc.documentId}`;
    return `doc:${doc.documentId}`;
  } catch {
    return null;
  }
}

export function documentIdFromDocJson(
  documentJson: string | null | undefined
): string | null {
  if (!documentJson) return null;
  try {
    const doc = JSON.parse(documentJson) as { documentId?: string };
    return doc.documentId ?? null;
  } catch {
    return null;
  }
}

export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function parseBankQuestion(questionJson: string): VelocityQuestion | null {
  try {
    const q = JSON.parse(questionJson) as VelocityQuestion;
    if (!q || !q.type || !q.question) return null;
    return q;
  } catch {
    return null;
  }
}

export function stemIsContextDependent(stem: string): boolean {
  const s = stem.trim();
  if (!s) return true;
  return BANNED_STEM_PATTERNS.some((re) => re.test(s));
}

function looksLikeTextbookMeasurement(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (TEXTBOOK_DATAPOINT_ANSWER.test(v)) return true;
  if (SCI_NOTATION_SHAPE.test(v) && /(?:mol|M|s|L|\/)/.test(v)) return true;
  return false;
}

export function questionIsTextbookDatapoint(
  stem: string,
  canonicalAnswer: string | undefined,
  mcOptions?: readonly string[]
): boolean {
  const s = stem.trim();
  if (!s) return false;
  if (TEXTBOOK_DATAPOINT_STEM_PATTERNS.some((re) => re.test(s))) return true;
  if (canonicalAnswer && looksLikeTextbookMeasurement(canonicalAnswer)) {
    return true;
  }
  if (mcOptions && mcOptions.length > 0) {
    const measurementOptions = mcOptions.filter(looksLikeTextbookMeasurement)
      .length;
    if (measurementOptions >= 2) return true;
  }
  return false;
}

export function fuzzyStemKey(stem: string): string {
  const STOP = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "of", "in", "on", "at", "to", "from", "by", "for", "with", "as",
    "and", "or", "but", "so", "than", "then", "that", "this", "these",
    "those", "it", "its", "what", "which", "who", "whom", "whose", "when",
    "where", "why", "how", "do", "does", "did", "can", "could", "would",
    "should", "will", "shall", "may", "might", "must", "about", "above",
    "below", "into", "onto", "over", "under", "up", "out", "off",
  ]);
  return stem
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((tok) => tok.length >= 3 && !STOP.has(tok))
    .sort()
    .join(" ");
}

function passesBankFilters(q: VelocityQuestion): boolean {
  if (q.type !== "mc") return false;
  if (stemIsContextDependent(q.question)) return false;
  if (
    questionIsTextbookDatapoint(q.question, undefined, q.options)
  ) {
    return false;
  }
  return true;
}

export interface McQuestionPick {
  bankRowId: string;
  question: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanation?: string;
}

function addMcPick(
  seen: Set<string>,
  pool: McQuestionPick[],
  pick: McQuestionPick
): void {
  const key = pick.question.trim().toLowerCase();
  const fuzzy = fuzzyStemKey(pick.question);
  if (seen.has(key) || (fuzzy && seen.has(fuzzy))) return;
  seen.add(key);
  if (fuzzy) seen.add(fuzzy);
  pool.push(pick);
}

function mcPickFromQuizRow(r: { id: string; questionJson: string }): McQuestionPick | null {
  try {
    const raw = JSON.parse(r.questionJson) as {
      question?: string;
      options?: string[];
      correctIndex?: number;
      explanation?: string;
    };
    if (
      !raw.question ||
      !Array.isArray(raw.options) ||
      raw.options.length !== 4 ||
      typeof raw.correctIndex !== "number" ||
      raw.correctIndex < 0 ||
      raw.correctIndex > 3
    ) {
      return null;
    }
    const q: VelocityQuestion = {
      type: "mc",
      roundType: "tossup",
      pairId: "quiz",
      question: raw.question,
      options: raw.options as [string, string, string, string],
      correctIndex: raw.correctIndex as 0 | 1 | 2 | 3,
      topic: "",
      explanation: raw.explanation,
    };
    if (!passesBankFilters(q)) return null;
    return {
      bankRowId: `quiz:${r.id}`,
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
    };
  } catch {
    return null;
  }
}

async function collectVelocityMc(
  sourceKey: string,
  pageFilter: { exact: number[] } | { upTo: number },
  seen: Set<string>,
  pool: McQuestionPick[],
  limit: number
): Promise<void> {
  if (pool.length >= limit) return;

  const pageWhere =
    "exact" in pageFilter
      ? inArray(velocityQuestionBank.pageIndex, pageFilter.exact)
      : lte(velocityQuestionBank.pageIndex, pageFilter.upTo);

  const rows = await db.query.velocityQuestionBank.findMany({
    where: and(
      eq(velocityQuestionBank.sourceKey, sourceKey),
      pageWhere,
      eq(velocityQuestionBank.type, "mc"),
      lt(velocityQuestionBank.reportCount, BAD_QUESTION_REPORT_THRESHOLD)
    ),
    limit: 400,
  });

  for (const r of rows) {
    if (pool.length >= limit) break;
    const q = parseBankQuestion(r.questionJson);
    if (!q || q.type !== "mc" || !passesBankFilters(q)) continue;
    addMcPick(seen, pool, {
      bankRowId: `velocity:${r.id}`,
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
    });
  }
}

async function collectQuizMc(
  documentId: string,
  pageFilter: { exact: number[] } | { upTo: number },
  seen: Set<string>,
  pool: McQuestionPick[],
  limit: number
): Promise<void> {
  if (pool.length >= limit) return;

  const pageWhere =
    "exact" in pageFilter
      ? inArray(documentQuizQuestions.pageIndex, pageFilter.exact)
      : lte(documentQuizQuestions.pageIndex, pageFilter.upTo);

  const quizRows = await db.query.documentQuizQuestions.findMany({
    where: and(eq(documentQuizQuestions.documentId, documentId), pageWhere),
    limit: 200,
  });

  for (const r of quizRows) {
    if (pool.length >= limit) break;
    const pick = mcPickFromQuizRow(r);
    if (pick) addMcPick(seen, pool, pick);
  }
}

/**
 * Pull MC questions from velocity bank + document quiz bank for visited pages.
 *
 * Fallback strategy: if visited pages have no hits, widen to any page ≤ the
 * highest visited page — covering material the user could have already read
 * while avoiding questions from chapters ahead of them.
 */
export async function queryMcQuestionsForPages(opts: {
  sourceKey: string | null;
  documentId: string | null;
  pageIndexes: number[];
  limit?: number;
}): Promise<McQuestionPick[]> {
  const { sourceKey, documentId, pageIndexes, limit = EXIT_BOSS_COUNT } = opts;
  if (pageIndexes.length === 0) return [];

  const seen = new Set<string>();
  const pool: McQuestionPick[] = [];
  const exactFilter = { exact: pageIndexes };

  if (sourceKey) {
    await collectVelocityMc(sourceKey, exactFilter, seen, pool, limit);
  }
  if (documentId) {
    await collectQuizMc(documentId, exactFilter, seen, pool, limit);
  }

  if (pool.length < limit) {
    const maxVisited = Math.max(...pageIndexes);
    const upToFilter = { upTo: maxVisited };
    if (sourceKey) {
      await collectVelocityMc(sourceKey, upToFilter, seen, pool, limit);
    }
    if (documentId) {
      await collectQuizMc(documentId, upToFilter, seen, pool, limit);
    }
  }

  shuffleInPlace(pool);
  return pool.slice(0, limit);
}

export function parseVisitedPagesList(
  visitedPagesList: string | null | undefined
): number[] {
  if (!visitedPagesList) return [];
  try {
    const arr = JSON.parse(visitedPagesList) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}
