import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getAppUser } from "@/lib/app-user";
import { openai, MODEL, isAiConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { appendOwnerStyleToSystem, getAiOwnerStyleExtra } from "@/lib/app-settings";
import {
  clientErrorLogs,
  velocityGames,
  velocityQuestionBank,
} from "@/lib/db/schema";
import type { VelocityQuestion } from "@/lib/velocity-match";
import { assertAiBudget, recordAiUsage } from "@/lib/ai-usage";

/** Record AI / runtime failures so admins can inspect them in the debug log. */
async function logServerFailure(userId: string | null, email: string | null, err: unknown, extra?: unknown) {
  const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
  const stack = err instanceof Error ? err.stack ?? null : null;
  let extraJson: string | null = null;
  try {
    extraJson = extra != null ? JSON.stringify(extra).slice(0, 16000) : null;
  } catch {}
  try {
    await db.insert(clientErrorLogs).values({
      id: crypto.randomUUID(),
      createdAt: new Date(),
      kind: "dev",
      userId,
      email,
      message: `[velocity] ${message}`.slice(0, 4000),
      stack: stack?.slice(0, 32000) ?? null,
      url: null,
      userAgent: null,
      extra: extraJson,
    });
  } catch {
    /* logging must never throw */
  }
}

/** One batch = 12 toss-up/bonus pairs = 24 questions. The client plays this
 *  batch, then prompts the user to continue for one more batch (48 total).
 *  We deliberately use even-count pairs so the toss-up/bonus gating stays
 *  aligned — an odd batch would leave an orphan toss-up at the seam. */
const PAIR_COUNT = 12;
const MAX_QUESTIONS = PAIR_COUNT * 2;
/** Questions per batch (generated per /api/ai/velocity call). */
const DEFAULT_Q = PAIR_COUNT * 2;
/** Absolute cap on total questions in a single velocity_games row
 *  (initial batch + one continuation). */
const MAX_TOTAL_Q = DEFAULT_Q * 2;

// OpenAI structured outputs reject `oneOf` / discriminated unions, so we use a
// single flat schema where every field is always present and normalise
// per-type in TypeScript after the call.
const flatQuestionSchema = z.object({
  roundType: z.enum(["tossup", "bonus"]),
  pairId: z.string(),
  type: z.enum(["mc", "sa"]),
  question: z.string(),
  options: z.array(z.string()).length(4),
  correctIndex: z.number().int().min(0).max(3),
  answer: z.string(),
  /** Extra strings the grader should accept as correct — up to 5 synonyms,
   *  more-specific textbook names, or acronym/expansion pairs. Always
   *  required (may be empty for MC or when no alternates apply). */
  acceptedAnswers: z.array(z.string()).max(6),
  topic: z.string(),
  explanation: z.string(),
  /** 1-indexed source page in the reading; 0 when unknown / spans pages. */
  pageIndex: z.number().int().min(0),
});

const payloadSchema = z.object({
  questions: z.array(flatQuestionSchema).min(1).max(MAX_QUESTIONS),
});

function shuffleMc(q: VelocityQuestion): VelocityQuestion {
  if (q.type !== "mc") return q;
  const indices = [0, 1, 2, 3];
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const shuffled = indices.map((i) => q.options[i]) as [string, string, string, string];
  const newCorrect = indices.indexOf(q.correctIndex) as 0 | 1 | 2 | 3;
  return { ...q, options: shuffled, correctIndex: newCorrect };
}

/**
 * Drop the most unmistakable front/back-matter pages from accumulated text
 * so the model never has to see them. Conservative on purpose: only strips a
 * page if it has a strong non-content signal AND is short / lightly worded.
 * If ALL pages look like non-content we return the original text so the route
 * can still attempt generation rather than silently failing.
 */
function stripNonContentPages(accumulated: string): string {
  if (!accumulated || !accumulated.includes("[Page ")) return accumulated;

  const copyrightMarkers = [
    /\bisbn[\s:-]*[\d\-x]/i,
    /library of congress/i,
    /all rights reserved/i,
    /copyright\s*©|\(c\)\s*\d{4}|©\s*\d{4}/i,
    /printed in (the )?united states|printed in canada|printed in the uk/i,
    /cataloging-in-publication/i,
    /first (edition|printing)|second (edition|printing)/i,
  ];
  const listish = /(table of contents|contents at a glance|list of (figures|tables)|index|glossary|references|bibliography|works cited|acknowledg)/i;

  const blocks = accumulated.split(/(?=\n\n\[Page \d+\]\n)/g);
  const kept: string[] = [];
  for (const block of blocks) {
    const body = block.replace(/^\s*\[Page \d+\]\s*/m, "").trim();
    if (!body) continue;

    const words = body.split(/\s+/).filter(Boolean);
    const copyrightHits = copyrightMarkers.reduce(
      (n, re) => (re.test(body) ? n + 1 : n),
      0
    );

    const isShortPage = words.length < 120;
    // Heuristic: a line that ends with trailing dot-leaders + page number, e.g. "Chapter 2 ............. 45"
    const tocLineCount = (body.match(/\.{3,}\s*\d{1,4}\s*$/gm) ?? []).length;
    const tocish = listish.test(body) && (tocLineCount >= 3 || isShortPage);

    // Clear non-content signals: multiple copyright markers OR a short page with one marker OR a TOC-like page.
    if (copyrightHits >= 2 || (copyrightHits >= 1 && isShortPage) || tocish) {
      continue;
    }
    kept.push(block);
  }

  const stripped = kept.join("").trim();
  // Never return less than ~200 words total — if the filter was too aggressive,
  // fall back to the original so the model still has something real to work with.
  const keptWords = stripped.split(/\s+/).filter(Boolean).length;
  if (keptWords < 200) return accumulated;
  return stripped;
}

async function sessionOwnedByUser(sessionId: string, userId: string) {
  const row = await db.query.studySessions.findFirst({
    where: (s, { and: a, eq: e }) => a(e(s.id, sessionId), e(s.userId, userId)),
    columns: { id: true },
  });
  return !!row;
}

/** Parse `[Page N]` markers from the accumulated text into a set of 1-indexed page numbers. */
function parseReadingPages(accumulated: string): number[] {
  const re = /\[Page (\d+)\]/g;
  const set = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(accumulated)) !== null) {
    const n = parseInt(match[1], 10);
    if (Number.isFinite(n) && n > 0) set.add(n);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** Stable identifier for a reading source, used as the bank partition key. */
function sourceKeyFromDocJson(documentJson: string | null | undefined): string | null {
  if (!documentJson) return null;
  try {
    const doc = JSON.parse(documentJson) as { type?: string; documentId?: string };
    if (!doc.documentId) return null;
    if (doc.type === "textbook") return `textbook:${doc.documentId}`;
    return `doc:${doc.documentId}`;
  } catch {
    return null;
  }
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Re-hydrate a question row from the bank into a VelocityQuestion; null on corruption. */
function parseBankQuestion(questionJson: string): VelocityQuestion | null {
  try {
    const q = JSON.parse(questionJson) as VelocityQuestion;
    if (!q || !q.type || !q.question) return null;
    return q;
  } catch {
    return null;
  }
}

/**
 * Server-side guardrail: drop any question that references the source text
 * meta-contextually ("the example", "the passage", "as mentioned above", etc.)
 * or uses an unbound demonstrative/pronoun that only resolves with the reading
 * in front of you. Matches are case-insensitive and word-boundary aware.
 *
 * This is a hard filter because the prompt rules can still slip through — we
 * want to guarantee the user never sees a context-dependent question.
 */
const BANNED_STEM_PATTERNS: RegExp[] = [
  // Meta references to the source text
  /\b(?:the|this|that)\s+(?:example|passage|text|reading|book|chapter|section|article|paper|author|figure|diagram|table|graph|image|illustration|photograph|experiment|scenario|problem|case)\b/i,
  // "as mentioned / as described / as discussed / as shown / as noted / as stated / as explained / as given / as seen / as above / as below"
  /\bas\s+(?:mentioned|described|discussed|shown|noted|stated|explained|given|seen)\b/i,
  /\b(?:mentioned|described|discussed|shown|noted|stated|explained)\s+(?:above|below|in\s+the\s+text|in\s+the\s+reading|previously)\b/i,
  // "the two X named" / "the three Y listed" — textbook-listy phrasing
  /\bthe\s+\w+\s+(?:ideas|points|reasons|factors|steps|stages|types|kinds|categories|examples|principles|laws|properties|features|characteristics)\s+(?:named|listed|mentioned|given|described|discussed|shown)\b/i,
  // "X example" used as an unqualified reference (e.g. "the battery example")
  /\bthe\s+\w+\s+example\b/i,
  // Bare "above" / "below" as text locators
  /\b(?:above|below)\b.*\b(?:mentioned|listed|described|discussed|shown|given|stated|defined)\b/i,
];

function stemIsContextDependent(stem: string): boolean {
  const s = stem.trim();
  if (!s) return true;
  return BANNED_STEM_PATTERNS.some((re) => re.test(s));
}

/**
 * Reject questions that read as "look at the graph / table / experiment and
 * tell me the exact number". The combination of a time/concentration/rate
 * reference in the stem with a specific-value-shaped canonical answer is the
 * tell. We keep this narrow to avoid false-positives on legitimate universal-
 * constant questions like "How many chromosomes …" or "What is c in m/s?".
 */
const TEXTBOOK_DATAPOINT_STEM_PATTERNS: RegExp[] = [
  // "at t = 50", "at t=50"
  /\bat\s+t\s*=\s*\d/i,
  // "At 250 s, ...", "at 100 seconds", "at 60s what is …" — any reference to
  // a specific time in seconds/minutes/hours as a precondition of the question.
  /\bat\s+\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds|min|mins|minute|minutes|h|hr|hrs|hour|hours|ms)\b/i,
  /\bafter\s+\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds|min|mins|minute|minutes|h|hr|hrs|hour|hours|ms)\b/i,
  // "obtained / measured / reached / found at 100"
  /\b(?:obtained|measured|reached|found|calculated|determined)\s+at\s+\d/i,
  // "in this experiment", "for the reaction shown"
  /\bin\s+this\s+(?:experiment|reaction|trial|run|study)\b/i,
  /\bfor\s+the\s+(?:reaction|experiment|graph|curve|plot|table|data\s*set)\s+(?:shown|given|above|below|presented|described)\b/i,
  // "slope of the tangent to the X curve/plot/graph"
  /\bslope\s+of\s+the\s+tangent\s+(?:to|at|on|for)\b/i,
  // "what instantaneous / initial / average rate"
  /\bwhat\s+(?:instantaneous|initial|average)\s+rate\b/i,
  // "rate of <species> (?:disappearance|appearance|production|consumption|formation)"
  // when paired with a numeric or "at <time>" context — handled by the
  // time-based filters above; this one catches bare "rate of disappearance of
  // NO2" which almost always means a data-point read.
  /\brate\s+of\s+(?:disappearance|appearance|production|consumption|formation)\s+of\b/i,
  // "the rate/concentration/pH of Solution A/B/…"
  /\b(?:rate|concentration|pH|temperature|pressure|volume|mass|yield|equilibrium\s+constant)\s+of\s+(?:solution|sample|reaction|compound|mixture)\s+[A-Z]\b/i,
  // "the equilibrium/rate constant for this reaction/system"
  /\b(?:equilibrium\s+constant|rate\s+constant|k\s+value|Ka|Kb|Kc|Kp|Ksp)\s+(?:for|of)\s+(?:this|the)\s+(?:reaction|system|experiment|trial)\b/i,
];

/** Shape of a "specific textbook measurement" answer:
 *  scientific notation with rate-style units ("4.2 × 10^-5 mol/L·s", "2.1e-6 M/s"),
 *  or plain decimals with chem rate units. */
const TEXTBOOK_DATAPOINT_ANSWER = /^\s*[-+]?\d+(?:\.\d+)?\s*(?:[×x*eE]\s*10?\s*\^?\s*[-+]?\d+)?\s*(?:mol\/L·s|mol\/L\*s|mol\/L\s*s|mol\s*\/\s*L·s|mol\/L|M\/s|\/s|s\^?-?1)\s*$/i;

/** Cheap scientific-notation detector — true for strings like
 *  "4.2 × 10^-5 mol/L·s", "2.3e-6", "5 × 10⁻⁴ M/s". Used to flag MC
 *  questions where every distractor is a read-off-the-graph value. */
const SCI_NOTATION_SHAPE = /\d(?:\.\d+)?\s*(?:[×x*eE]\s*10?\s*\^?\s*[-+]?\d|e[-+]?\d)/i;

function looksLikeTextbookMeasurement(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (TEXTBOOK_DATAPOINT_ANSWER.test(v)) return true;
  // Scientific notation with any rate-style unit → textbook data.
  if (SCI_NOTATION_SHAPE.test(v) && /(?:mol|M|s|L|\/)/.test(v)) return true;
  return false;
}

function questionIsTextbookDatapoint(
  stem: string,
  canonicalAnswer: string | undefined,
  mcOptions?: readonly string[]
): boolean {
  const s = stem.trim();
  if (!s) return false;
  if (TEXTBOOK_DATAPOINT_STEM_PATTERNS.some((re) => re.test(s))) return true;
  // SA with a rate-unit canonical answer is almost certainly a read-off-the-
  // graph value, regardless of stem phrasing.
  if (canonicalAnswer && looksLikeTextbookMeasurement(canonicalAnswer)) {
    return true;
  }
  // MC where 2+ of the 4 distractors look like rate-unit measurements — the
  // question is asking the user to pick a specific experimental value.
  if (mcOptions && mcOptions.length > 0) {
    const measurementOptions = mcOptions.filter(looksLikeTextbookMeasurement).length;
    if (measurementOptions >= 2) return true;
  }
  return false;
}

/**
 * Build an aggressive content-only fingerprint of a question stem for fuzzy
 * dedupe. Strips punctuation, lowercases, drops stopwords and short tokens,
 * and sorts what's left. Two stems with the same set of significant content
 * words collapse to the same key — catches "At 250 s, what is the slope…"
 * vs "What is the slope of the tangent at 250s…" even though the exact
 * strings differ.
 */
function fuzzyStemKey(stem: string): string {
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

export async function GET(request: Request) {
  const user = await getAppUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  if (!(await sessionOwnedByUser(sessionId, user.id))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const row = await db.query.velocityGames.findFirst({
    where: (g, { eq }) => eq(g.sessionId, sessionId),
  });
  if (!row) return NextResponse.json({ error: "No velocity game found" }, { status: 404 });

  return NextResponse.json({
    id: row.id,
    sessionId: row.sessionId,
    questions: JSON.parse(row.questionsJson) as VelocityQuestion[],
    results: row.resultsJson ? JSON.parse(row.resultsJson) : null,
    review: row.reviewJson ? JSON.parse(row.reviewJson) : null,
    accuracy: row.accuracy,
    avgReactionMs: row.avgReactionMs,
  });
}

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI not configured. Set OPENAI_API_KEY in your environment." },
      { status: 503 }
    );
  }

  const overBudget = await assertAiBudget(user.id);
  if (overBudget) return overBudget;

  const body = (await request.json().catch(() => ({}))) as {
    sessionId?: string;
    accumulatedText?: string;
    /** When set, append a second batch to the existing game row instead of
     *  starting a new one. The caller must still be the owner of the
     *  underlying study session. */
    continueFromGameId?: string;
  };
  const { sessionId, accumulatedText, continueFromGameId } = body;
  if (!sessionId || !accumulatedText) {
    return NextResponse.json(
      { error: "sessionId and accumulatedText are required" },
      { status: 400 }
    );
  }

  const session = await db.query.studySessions.findFirst({
    where: (s, { and: a, eq: e }) => a(e(s.id, sessionId), e(s.userId, user.id)),
    columns: { id: true, documentJson: true },
  });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    // --- Continuation setup --------------------------------------------------
    // When continuing, load the existing game, verify it belongs to this
    // session, and exclude its question stems from both bank and AI output
    // so batch 2 never duplicates batch 1. We also compute how many more
    // questions we can add without blowing past MAX_TOTAL_Q.
    let existingQuestions: VelocityQuestion[] = [];
    const existingKeys = new Set<string>();
    let batchTargetCount = DEFAULT_Q;
    if (continueFromGameId) {
      const existing = await db.query.velocityGames.findFirst({
        where: (g, { and: a, eq: e }) =>
          a(e(g.id, continueFromGameId), e(g.sessionId, session.id)),
        columns: { id: true, questionsJson: true },
      });
      if (!existing) {
        return NextResponse.json(
          { error: "Velocity game not found for this session" },
          { status: 404 }
        );
      }
      try {
        const parsed = JSON.parse(existing.questionsJson) as VelocityQuestion[];
        if (Array.isArray(parsed)) existingQuestions = parsed;
      } catch {
        existingQuestions = [];
      }
      for (const q of existingQuestions) {
        existingKeys.add(q.question.trim().toLowerCase());
        const fuzzy = fuzzyStemKey(q.question);
        if (fuzzy) existingKeys.add(fuzzy);
      }
      batchTargetCount = Math.max(
        0,
        Math.min(DEFAULT_Q, MAX_TOTAL_Q - existingQuestions.length)
      );
      if (batchTargetCount === 0) {
        return NextResponse.json(
          {
            error: `Velocity is capped at ${MAX_TOTAL_Q} questions per game.`,
          },
          { status: 400 }
        );
      }
    }

    // Resolve the reading's stable identity (for the shared question bank) and
    // the set of pages actually covered in this session's accumulated text.
    const sourceKey = sourceKeyFromDocJson(session.documentJson);
    const readingPages = parseReadingPages(accumulatedText);

    // --- Bank lookup ---------------------------------------------------------
    // Pull every question we've previously generated for this document that
    // touches a page the user just read. Dedupe by question text (AI
    // occasionally produces near-duplicates across runs). On a continuation
    // we also skip anything already played in batch 1.
    let bankPool: VelocityQuestion[] = [];
    if (sourceKey && readingPages.length > 0) {
      const rows = await db.query.velocityQuestionBank.findMany({
        where: (b, { and: a, eq: e, inArray: inA }) =>
          a(e(b.sourceKey, sourceKey), inA(b.pageIndex, readingPages)),
        limit: 400,
      });
      const seen = new Set<string>(existingKeys);
      for (const r of rows) {
        const q = parseBankQuestion(r.questionJson);
        if (!q) continue;
        // Hard filter: older bank rows may contain context-dependent stems
        // or textbook-specific data-point questions from before the stricter
        // prompt rules landed. Skip those.
        if (stemIsContextDependent(q.question)) continue;
        if (
          questionIsTextbookDatapoint(
            q.question,
            q.type === "sa" ? q.answer : undefined,
            q.type === "mc" ? q.options : undefined
          )
        ) {
          continue;
        }
        const key = q.question.trim().toLowerCase();
        const fuzzy = fuzzyStemKey(q.question);
        if (seen.has(key) || (fuzzy && seen.has(fuzzy))) continue;
        seen.add(key);
        if (fuzzy) seen.add(fuzzy);
        bankPool.push(q);
      }
      shuffleInPlace(bankPool);
    }

    const bankPicked = bankPool.slice(0, batchTargetCount);
    const shortfall = Math.max(0, batchTargetCount - bankPicked.length);

    const notes = await db.query.aiNotes.findMany({
      where: (n, { eq }) => eq(n.sessionId, sessionId),
    });
    const notesContext = notes.map((n) => n.content).join("\n\n");
    const ownerExtra = await getAiOwnerStyleExtra();

    // --- AI top-up -----------------------------------------------------------
    let aiQuestions: VelocityQuestion[] = [];
    if (shortfall > 0) {
      const targetCount = shortfall;
      const targetPairs = Math.max(1, Math.ceil(targetCount / 2));

      const baseSystem = `You are writing exactly ${targetCount} quiz-bowl style science questions from the reading, formatted as ${targetPairs} toss-up/bonus pairs for NSB-style play.

SOURCE FILTERING (critical — read before anything else):
- The reading may contain non-content "front matter" or "back matter" pages from a textbook. You MUST NOT write questions from any of these:
  - Title page, half-title, copyright/credits page, ISBN page, publisher info, edition/printing info.
  - Dedication, epigraph, "About the author", preface, foreword, acknowledgements.
  - Table of contents, list of figures, list of tables, chapter outlines, learning objectives lists.
  - Index, glossary-as-list, bibliography, references, works-cited, appendix indexes.
  - Review-question lists, end-of-chapter exercise stems, problem-set numbers, answer keys.
  - Page headers/footers, running titles, chapter numbers, blank pages, errata.
- Treat a page as non-content if it is mostly: names of people/publishers with no concepts, lists of section titles with page numbers, copyright/trademark text, or isbn/doi strings.
- If most of the reading is non-content, still produce ${targetCount} questions but source them ONLY from the minority of real content pages. Never invent concepts that are not present in the content pages.
- Do NOT ask about the book's title, author, publisher, chapter name, page number, or which chapter a topic appears in.

VOICE & FORMAT
- Questions are ONE punchy sentence a moderator could read aloud — ideally under 120 characters.
- No meta phrasing like "Based on the reading…" or "According to the text…".
- Prioritise the most foundational, examinable concepts. Skip trivia and anecdotes.
- Output order MUST alternate strictly: tossup, bonus, tossup, bonus, ... until ${targetCount} total.

SELF-CONTAINED QUESTIONS (critical — do NOT violate — this is a HARD REJECT filter)
Each question must be answerable by someone who has NEVER seen the source text. If the question references "the reading", "the example", "the battery", "this extinction", etc., it will be deleted server-side before the user ever sees it. That means YOU just wasted a slot. Treat this section as law.

Banned phrases anywhere in the stem (automatic reject):
- "the example", "this example", "the given example", "in the example", "as the example shows"
- "the passage", "this passage", "the text", "the reading", "the book", "the chapter", "the section", "the article", "the paper", "the author"
- "the figure", "this figure", "the diagram", "the table", "the graph", "the image", "the illustration", "the photograph"
- "as mentioned", "as described", "as discussed", "as shown", "as noted", "as stated", "as explained", "as given", "as seen above", "as seen below", "above", "below" (when referring to the text)
- "the experiment", "this experiment", "the scenario", "this scenario", "the problem", "this problem", "the case", "this case" (unless the case/scenario is fully named, like "the Miller–Urey experiment")
- "the two core ideas named" / "the three key points made" / any phrasing that treats the text as an enumerated list the reader can see

Banned reference patterns (automatic reject):
- Unbound demonstratives: "this/that/these/those/it/he/she/they" that don't refer to a concrete noun stated earlier IN THE SAME STEM.
- "the <common noun>" where the noun is only uniquely identifiable from the surrounding reading. Examples that get rejected:
  - BAD: "About how many million years ago did this extinction occur?" (which extinction?)
  - BAD: "What process in the battery forms hydrogen and oxygen?" (which battery? name it: "a lead-acid battery")
  - BAD: "What are the two core ideas named in the battery example?" (DOUBLE-BANNED: "the battery" AND "example")
  - BAD: "What force causes the motion described?" (what motion?)
  - BAD: "Which step comes next?" / "How much of it was produced?" / "What did he discover?"
  Fix by naming the concept in the stem itself: "About how many million years ago did the Cretaceous–Paleogene extinction occur?" / "What process splits water into H₂ and O₂ in a lead-acid battery during overcharge?"

RULE OF THUMB: before you write a stem, ask yourself "could someone who has never opened this book answer this?" If no — rewrite or pick a different concept.

NO TEXTBOOK-SPECIFIC DATA POINTS (critical — also a HARD REJECT filter)
Never ask for a numerical value, concentration, rate, temperature, pH, mass, or percentage that is only answerable by reading a specific graph, table, or worked example from the source. These are context-dependent by construction — a cold reader can't compute them. This applies to BOTH short-answer AND multiple-choice. An MC question where all four options are scientific-notation rate values (e.g. "4.2 × 10⁻⁵ mol/L·s", "4.3 × 10⁻⁶ mol/L·s", "2.4 × 10⁻⁵ mol/L·s", "8.6 × 10⁻⁶ mol/L·s") is just as textbook-specific as the SA version — the options ARE the graph values. Don't write these.

Examples of what gets rejected server-side:
- BAD: "What instantaneous rate for NO2 disappearance is obtained at 100 s?" (only answerable by reading a specific graph)
- BAD (MC): "At 250 s, what is the slope of the tangent to the O2 curve?" with options like "4.2 × 10⁻⁵ mol/L·s" / "4.3 × 10⁻⁶ mol/L·s" / "2.4 × 10⁻⁵ mol/L·s" / "8.6 × 10⁻⁶ mol/L·s" — the whole quartet is a read-off-the-graph quiz.
- BAD: "At what time does the reaction reach half-completion?" / "What is the concentration at t = 50 s?"
- BAD: "What is the initial rate measured in this experiment?" / "What yield was obtained in the reaction?"
- BAD: "What is the equilibrium constant for the reaction shown?"
- BAD: "What is the pH of Solution A?" / "What molarity of NaOH is used?"
- BAD: any answer (or MC option set) of the form "X × 10^±Y <unit>" that is tied to a specific experiment in the reading.

Also avoid "slope of the tangent to the <species> curve at t = …" — this is always a specific-graph question. If you want to test rate-law understanding, ask it as a concept instead: "In a rate law rate = k[A]², how does doubling [A] change the rate?" (MC: "2×", "4×", "8×", "unchanged") — same idea, zero textbook context required.

You MAY ask for numerical values that are universal constants, widely-memorised facts, or values intrinsic to a named entity (not tied to a specific experiment in the source):
- OK: "How many chromosomes are in a human somatic cell?" answer: 46
- OK: "What is the approximate speed of light in a vacuum (m/s)?" answer: "3 × 10^8"
- OK: "At what temperature (°C) does pure water freeze at 1 atm?" answer: 0
- OK: "How many constellations are currently officially recognized?" answer: 88
- OK: atomic numbers, molar masses of simple elements, half-lives of well-known isotopes, the charge on an electron, etc.

Rule of thumb: if the answer would change if we swapped out a different example/experiment from the same textbook, it's textbook-specific → don't ask it. If the answer is a universal fact that would be the same in any textbook, it's fine.

CANONICAL ANSWER QUALITY (short-answer only — read carefully, this is the #1 source of grading complaints)
- The "answer" field must be the MOST SPECIFIC named process / entity / term that describes the phenomenon in the stem. Never use a generic parent category ("decomposition", "reaction", "predator", "gas") when a specific textbook term exists.
- FIXED EXAMPLE you MUST internalise: a question like "What process splits water into hydrogen and oxygen in an electrolyte using an electric current?" → answer = "electrolysis". It is WRONG to put "decomposition" here just because electrolysis is a kind of decomposition reaction. If there is a named process (electrolysis, photosynthesis, respiration, glycolysis, transcription, translation, meiosis, mitosis, endocytosis, apoptosis, oxidation, reduction, combustion, sublimation, deposition, condensation, precipitation, neutralization, titration, etc.), USE THAT NAMED PROCESS as the canonical answer.
- Same rule for entities: if the reading describes a keystone species, answer "keystone species", not "animal"; a legume, not "plant"; a neurotransmitter, not "chemical"; a quark, not "particle".
- Keep the answer to 1–4 words, a single number (with unit if the stem does not supply it), a name, or a formula.
- The stem must be phrased so the canonical answer is the single obviously best response. If multiple equally-specific answers would be correct, rewrite the stem.
- Populate "acceptedAnswers" with up to 6 ALTERNATE strings the grader should also accept. Include:
  - common synonyms of the canonical answer,
  - equally-specific alternative names (e.g. "Krebs cycle" for "citric acid cycle"),
  - the canonical answer's standard acronym or its expansion (BOTH directions — if canonical is "cosmic microwave background", include "CMB"; if canonical is "DNA", include "deoxyribonucleic acid"),
  - chemical formula ↔ name pairs when relevant (e.g. "H2O" / "water").
  Do NOT include more-generic parents of the canonical answer — those are wrong, not alternate-correct.
  For MC questions, leave "acceptedAnswers" as an empty array [].

TYPES (output "type" as "mc" or "sa"; aim for ~60% mc / ~40% sa)
- "mc" (multiple choice): 4 crisp answer options in "options", one is correct. "correctIndex" (0–3) points at it and "answer" MUST equal options[correctIndex] verbatim. Vary the correct position across questions.
- "sa" (short answer): "answer" is a SHORT canonical reply — a noun, number, name, formula, or 1–4 word phrase. Because the schema still requires 4 "options", fill them with four plausible-but-incorrect distractor phrases; they are never shown to the user.

PAIRING RULES (critical):
- Every toss-up MUST be followed by its matching bonus.
- The bonus must be directly or closely related to its toss-up (same concept family/topic, not random adjacent content).
- The bonus should be slightly harder than its toss-up (more specific, one step deeper, or with a tighter distractor set).
- Set "roundType" to "tossup" or "bonus" correctly.
- Use the same "pairId" for the toss-up and its bonus. Pair IDs can be "1", "2", ... "${targetPairs}".

MATH & CALCULATION QUESTIONS → BONUSES ONLY
- Toss-ups are a 5-second race; bonuses give the user ~20 seconds. Any question that requires the user to *do arithmetic in their head* belongs in the BONUS slot, never the toss-up.
- Treat a question as "math" (and therefore bonus-only) if ANY of these are true:
  * the answer is a computed number (molarity, mole count, pH, kinetic energy, momentum, velocity, probability, percent yield, concentration after dilution, Ka/Kb from pKa, final temperature from q = mcΔT, half-life remaining, etc.).
  * the stem contains explicit numeric inputs the user must combine ("Given [HCl] = 0.050 M and [OH⁻] = 2.0 × 10⁻³ M, what is…", "A 2.5 g sample…", "At 250 K and 1.2 atm…").
  * the canonical answer is a formula the user must rearrange and plug values into, even if the numbers are simple.
- Concept / recall / definition questions stay on the toss-up side. Example pair:
  * TOSSUP (concept, fast recall): "In the equation q = mcΔT, what property does 'c' represent?" → "specific heat capacity"
  * BONUS (math, needs ~20s): "How much heat is required to raise the temperature of 50.0 g of water (c = 4.18 J/g·°C) by 25.0 °C?" → "5225 J" (or "5.2 × 10³ J")
- If a concept has no natural numeric question, don't force one — write two concept questions instead. Never put a calculation on the toss-up just to fill the slot.

SOURCE PAGE TAGGING (required on every question)
- Every page in the reading is demarcated by a "[Page N]" marker (1-indexed). For each question, set "pageIndex" to the N of the page where the concept the question asks about is primarily introduced or explained.
- If the concept spans multiple pages, choose the first page where it is defined/introduced.
- If you truly cannot locate a single page (e.g. the concept is background knowledge not tied to a specific page in the reading), set "pageIndex" to 0.
- Never invent a page number — it must be a value you actually saw in a "[Page N]" marker, or 0.

HARD BANS for short-answer questions — do NOT write questions where any of these apply:
- The answer is a full sentence or clause.
- The stem starts with "Why", "Explain", "Describe", "Discuss", "How does", "What happens if", "What is the difference between".
- The answer requires reasoning or justification ("why X causes Y", "explain how").
- The question is multi-part, compound, or asks for more than one fact at once.
- The answer is a list longer than 3 items.
If the concept only yields an essay-style answer, write it as MC instead.

GOOD EXAMPLES (match this tone and brevity)
MC:
- "A photon of what wavelength carries the most energy?" options: ["Red","Ultraviolet","Infrared","Blue"] correctIndex: 1
- "Which of the following is NOT a nucleic acid?" options: ["DNA","RNA","ATP","DNR"] correctIndex: 3
- "On a geology field trip, you come across a sedimentary rock containing ripple marks. These marks might contain information about which of the following?" options: ["Water depth","Seasonal climate variability","Flow direction","Local vegetation"] correctIndex: 2

SA:
- "In what organ does the female germ cell develop?" answer: "ovary"
- "What is the structure capable of transporting dissolved organic material throughout a plant?" answer: "phloem"
- "An atom of what isotope has a nucleus that contains eight protons and ten neutrons?" answer: "oxygen-18"
- "How many constellations are currently officially recognized?" answer: "88"
- "Who was the first American woman to fly in space?" answer: "Sally Ride"

SCHEMA — every field is REQUIRED on EVERY question:
- roundType, pairId, type, question, options (4 strings), correctIndex (0–3), answer, acceptedAnswers (array of strings, may be empty), topic (2–5 words labelling the concept), explanation (one short sentence), pageIndex (integer from the reading, 0 if unknown).`;

      const { object, usage } = await generateObject({
        model: openai(MODEL),
        schema: payloadSchema,
        system: appendOwnerStyleToSystem(baseSystem, ownerExtra),
        prompt: `Reading material (non-content / front-matter pages have already been removed where possible). Pages in the reading: ${
          readingPages.length > 0 ? readingPages.join(", ") : "unknown"
        }. When tagging "pageIndex", use one of those numbers (or 0 if the concept cannot be tied to a specific page).\n\n${stripNonContentPages(
          accumulatedText
        ).slice(0, 10000)}\n\n${
          notesContext ? `Session notes:\n${notesContext.slice(0, 3000)}` : ""
        }`,
      });
      await recordAiUsage(user.id, "/api/ai/velocity", usage);

      const readingPagesSet = new Set(readingPages);
      // Final server-side safety net: drop any stem that still references
      // "the example", "the passage", "this battery", etc. before we even
      // look at it further. Prompt-level rules occasionally leak, and we
      // never want the user to see a context-dependent question.
      // Also drop stems the user already saw in a previous batch, and reject
      // textbook-specific "read off the graph" numeric-answer questions.
      // Existing keys are already populated with both exact + fuzzy variants
      // from the bank pass below, so AI questions that fuzzy-match a bank
      // question (or a previous-batch question) also get dropped.
      const rawQuestions = object.questions.filter((q) => {
        if (stemIsContextDependent(q.question)) return false;
        if (
          questionIsTextbookDatapoint(
            q.question,
            q.type === "sa" ? q.answer : undefined,
            q.type === "mc" ? (q.options as readonly string[]) : undefined
          )
        ) {
          return false;
        }
        const exact = q.question.trim().toLowerCase();
        if (existingKeys.has(exact)) return false;
        const fuzzy = fuzzyStemKey(q.question);
        if (fuzzy && existingKeys.has(fuzzy)) return false;
        return true;
      });
      aiQuestions = rawQuestions.map((q, i) => {
        const roundType = q.roundType ?? (i % 2 === 0 ? "tossup" : "bonus");
        const pairId = (q.pairId && q.pairId.trim()) || String(Math.floor(i / 2) + 1);
        // Only accept page indexes the model could actually have seen in the
        // reading — otherwise fall back to 0 ("unknown").
        const pageIndex =
          typeof q.pageIndex === "number" && readingPagesSet.has(q.pageIndex)
            ? q.pageIndex
            : 0;
        const acceptedAnswers = Array.isArray(q.acceptedAnswers)
          ? q.acceptedAnswers
              .map((s) => (typeof s === "string" ? s.trim() : ""))
              .filter((s) => s.length > 0)
              .slice(0, 6)
          : [];
        if (q.type === "mc") {
          const correctIdx = Math.min(3, Math.max(0, q.correctIndex)) as 0 | 1 | 2 | 3;
          return shuffleMc({
            roundType,
            pairId,
            type: "mc",
            question: q.question,
            options: q.options as [string, string, string, string],
            correctIndex: correctIdx,
            topic: q.topic,
            explanation: q.explanation,
            pageIndex,
          });
        }
        return {
          roundType,
          pairId,
          type: "sa",
          question: q.question,
          answer: q.answer,
          acceptedAnswers,
          topic: q.topic,
          explanation: q.explanation,
          pageIndex,
        };
      });

      // Persist every AI-generated question to the shared bank so future
      // sessions that read the same pages can reuse them without paying for
      // another generation. Silent-fail per row — if one insert breaks we
      // still want the others to land.
      if (sourceKey) {
        const now = new Date();
        for (const q of aiQuestions) {
          try {
            await db.insert(velocityQuestionBank).values({
              id: crypto.randomUUID(),
              sourceKey,
              pageIndex: q.pageIndex ?? 0,
              topic: q.topic ?? null,
              type: q.type,
              questionJson: JSON.stringify(q),
              createdBy: user.id,
              createdAt: now,
            });
          } catch {
            /* non-fatal — skip bank write on failure */
          }
        }
      }
    }

    // --- Combine + normalise -------------------------------------------------
    // Interleave bank picks and fresh AI picks for THIS batch only, dedupe
    // against existing questions from batch 1 (when continuing), and cap at
    // the per-batch target.
    const combinedSeen = new Set<string>(existingKeys);
    const batchQuestions: VelocityQuestion[] = [];
    for (const q of [...bankPicked, ...aiQuestions]) {
      const key = q.question.trim().toLowerCase();
      const fuzzy = fuzzyStemKey(q.question);
      if (combinedSeen.has(key)) continue;
      if (fuzzy && combinedSeen.has(fuzzy)) continue;
      combinedSeen.add(key);
      if (fuzzy) combinedSeen.add(fuzzy);
      batchQuestions.push(q);
      if (batchQuestions.length >= batchTargetCount) break;
    }

    if (batchQuestions.length === 0) {
      return NextResponse.json(
        { error: "Could not find or generate any Velocity questions for this reading." },
        { status: 500 }
      );
    }

    // Re-normalise the FULL question list (existing + new) so tossup/bonus
    // alternation and pairIds stay correct across the seam.
    const fullList = [...existingQuestions, ...batchQuestions];
    const normalisedQuestions = fullList.map((q, i) => ({
      ...q,
      roundType: (i % 2 === 0 ? "tossup" : "bonus") as "tossup" | "bonus",
      pairId: String(Math.floor(i / 2) + 1),
    })) as VelocityQuestion[];

    let gameId: string;
    if (continueFromGameId) {
      gameId = continueFromGameId;
      await db
        .update(velocityGames)
        .set({ questionsJson: JSON.stringify(normalisedQuestions) })
        .where(eq(velocityGames.id, continueFromGameId));
    } else {
      gameId = crypto.randomUUID();
      await db.insert(velocityGames).values({
        id: gameId,
        sessionId,
        questionsJson: JSON.stringify(normalisedQuestions),
        resultsJson: null,
        reviewJson: null,
        accuracy: null,
        avgReactionMs: null,
        createdAt: new Date(),
        completedAt: null,
      });
    }

    return NextResponse.json({
      id: gameId,
      questions: normalisedQuestions,
      bankCount: bankPicked.length,
      generatedCount: aiQuestions.length,
      /** Number of questions added in THIS request (batch size). Useful for
       *  the client when appending to an in-memory list. */
      addedCount: batchQuestions.length,
      /** How many questions the game has total after this request. */
      totalCount: normalisedQuestions.length,
      /** True when the game has hit MAX_TOTAL_Q and cannot be continued. */
      capped: normalisedQuestions.length >= MAX_TOTAL_Q,
    });
  } catch (err) {
    await logServerFailure(user.id, user.email ?? null, err, {
      route: "POST /api/ai/velocity",
      sessionId,
      textLength: accumulatedText.length,
    });
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to generate Velocity questions: ${detail}` },
      { status: 500 }
    );
  }
}
