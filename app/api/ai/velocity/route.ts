import { NextResponse } from "next/server";
import { generateObject } from "ai";
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

const PAIR_COUNT = 25;
const MAX_QUESTIONS = PAIR_COUNT * 2;
const DEFAULT_Q = PAIR_COUNT * 2;

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

  const body = (await request.json().catch(() => ({}))) as {
    sessionId?: string;
    accumulatedText?: string;
  };
  const { sessionId, accumulatedText } = body;
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
    // Resolve the reading's stable identity (for the shared question bank) and
    // the set of pages actually covered in this session's accumulated text.
    const sourceKey = sourceKeyFromDocJson(session.documentJson);
    const readingPages = parseReadingPages(accumulatedText);

    // --- Bank lookup ---------------------------------------------------------
    // Pull every question we've previously generated for this document that
    // touches a page the user just read. Dedupe by question text (AI
    // occasionally produces near-duplicates across runs).
    let bankPool: VelocityQuestion[] = [];
    if (sourceKey && readingPages.length > 0) {
      const rows = await db.query.velocityQuestionBank.findMany({
        where: (b, { and: a, eq: e, inArray: inA }) =>
          a(e(b.sourceKey, sourceKey), inA(b.pageIndex, readingPages)),
        limit: 400,
      });
      const seen = new Set<string>();
      for (const r of rows) {
        const q = parseBankQuestion(r.questionJson);
        if (!q) continue;
        const key = q.question.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        bankPool.push(q);
      }
      shuffleInPlace(bankPool);
    }

    const bankPicked = bankPool.slice(0, DEFAULT_Q);
    const shortfall = Math.max(0, DEFAULT_Q - bankPicked.length);

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

SELF-CONTAINED QUESTIONS (critical — do NOT violate)
Each question must be answerable by someone who has NEVER seen the source text. That means:
- NEVER use unbound demonstrative references that require the reader to remember what was just read:
  - BAD: "About how many million years ago did this extinction occur?" (which extinction?)
  - BAD: "What process in the battery forms hydrogen and oxygen?" (which battery?)
  - BAD: "What force causes the motion described?" (what motion?)
  - BAD: "Which step comes next?"  "How much of it was produced?"  "What did he discover?"
  Fix by naming the concept: "About how many million years ago did the Cretaceous–Paleogene extinction occur?" / "What process in a lead-acid car battery produces hydrogen and oxygen gas during overcharge?"
- Resolve every pronoun and "this/that/these/those/it/he/she/they" to a concrete noun the reader can identify without the passage.
- Never reference "the passage", "the figure", "the table", "the diagram", "the author", "the example", "the experiment", "the book", "the chapter", "the section", "the reading", "the text", or a numbered equation/table from the book.
- If a concept only makes sense with surrounding context the question cannot supply, pick a different, self-contained fact to ask about instead.

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

      const { object } = await generateObject({
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

      const readingPagesSet = new Set(readingPages);
      aiQuestions = object.questions.map((q, i) => {
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
    // Interleave bank picks and fresh AI picks, then force strict
    // tossup/bonus alternation and renumber pair IDs based on final position.
    const combinedSeen = new Set<string>();
    const combined: VelocityQuestion[] = [];
    for (const q of [...bankPicked, ...aiQuestions]) {
      const key = q.question.trim().toLowerCase();
      if (combinedSeen.has(key)) continue;
      combinedSeen.add(key);
      combined.push(q);
      if (combined.length >= DEFAULT_Q) break;
    }

    if (combined.length === 0) {
      return NextResponse.json(
        { error: "Could not find or generate any Velocity questions for this reading." },
        { status: 500 }
      );
    }

    const normalisedQuestions = combined.map((q, i) => ({
      ...q,
      roundType: (i % 2 === 0 ? "tossup" : "bonus") as "tossup" | "bonus",
      pairId: String(Math.floor(i / 2) + 1),
    })) as VelocityQuestion[];

    const id = crypto.randomUUID();
    await db.insert(velocityGames).values({
      id,
      sessionId,
      questionsJson: JSON.stringify(normalisedQuestions),
      resultsJson: null,
      reviewJson: null,
      accuracy: null,
      avgReactionMs: null,
      createdAt: new Date(),
      completedAt: null,
    });

    return NextResponse.json({
      id,
      questions: normalisedQuestions,
      bankCount: bankPicked.length,
      generatedCount: aiQuestions.length,
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
