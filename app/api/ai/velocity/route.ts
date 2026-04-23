import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getAppUser } from "@/lib/app-user";
import { openai, MODEL, isAiConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { appendOwnerStyleToSystem, getAiOwnerStyleExtra } from "@/lib/app-settings";
import { clientErrorLogs, velocityGames } from "@/lib/db/schema";
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
  topic: z.string(),
  explanation: z.string(),
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

  if (!(await sessionOwnedByUser(sessionId, user.id))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    const notes = await db.query.aiNotes.findMany({
      where: (n, { eq }) => eq(n.sessionId, sessionId),
    });
    const notesContext = notes.map((n) => n.content).join("\n\n");
    const ownerExtra = await getAiOwnerStyleExtra();

    const baseSystem = `You are writing exactly ${DEFAULT_Q} quiz-bowl style science questions from the reading, formatted as ${PAIR_COUNT} toss-up/bonus pairs for NSB-style play.

SOURCE FILTERING (critical — read before anything else):
- The reading may contain non-content "front matter" or "back matter" pages from a textbook. You MUST NOT write questions from any of these:
  - Title page, half-title, copyright/credits page, ISBN page, publisher info, edition/printing info.
  - Dedication, epigraph, "About the author", preface, foreword, acknowledgements.
  - Table of contents, list of figures, list of tables, chapter outlines, learning objectives lists.
  - Index, glossary-as-list, bibliography, references, works-cited, appendix indexes.
  - Review-question lists, end-of-chapter exercise stems, problem-set numbers, answer keys.
  - Page headers/footers, running titles, chapter numbers, blank pages, errata.
- Treat a page as non-content if it is mostly: names of people/publishers with no concepts, lists of section titles with page numbers, copyright/trademark text, or isbn/doi strings.
- If most of the reading is non-content, still produce ${DEFAULT_Q} questions but source them ONLY from the minority of real content pages. Never invent concepts that are not present in the content pages.
- Do NOT ask about the book's title, author, publisher, chapter name, page number, or which chapter a topic appears in.

VOICE & FORMAT
- Questions are ONE punchy sentence a moderator could read aloud — ideally under 120 characters.
- No meta phrasing like "Based on the reading…" or "According to the text…".
- Prioritise the most foundational, examinable concepts. Skip trivia and anecdotes.
- Output order MUST alternate strictly: tossup, bonus, tossup, bonus, ... until ${DEFAULT_Q} total.

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

CANONICAL ANSWER QUALITY (short-answer only)
- The "answer" field must be the MOST SPECIFIC correct term the reading uses — not a generic category.
  - If the reading describes water being split in a lead-acid battery, the answer is "electrolysis", not "decomposition".
  - If the reading says a species is a keystone predator, the answer is "keystone species", not "predator".
- Prefer the textbook's exact term where one exists.
- Keep the answer to 1–4 words, a single number (with unit if the stem does not already supply it), a name, or a formula.
- The stem must be phrased so that the canonical answer is the single obviously best response — avoid stems where multiple equally specific answers are correct.

TYPES (output "type" as "mc" or "sa"; aim for ~60% mc / ~40% sa)
- "mc" (multiple choice): 4 crisp answer options in "options", one is correct. "correctIndex" (0–3) points at it and "answer" MUST equal options[correctIndex] verbatim. Vary the correct position across questions.
- "sa" (short answer): "answer" is a SHORT canonical reply — a noun, number, name, formula, or 1–4 word phrase. Because the schema still requires 4 "options", fill them with four plausible-but-incorrect distractor phrases; they are never shown to the user.

PAIRING RULES (critical):
- Every toss-up MUST be followed by its matching bonus.
- The bonus must be directly or closely related to its toss-up (same concept family/topic, not random adjacent content).
- The bonus should be slightly harder than its toss-up (more specific, one step deeper, or with a tighter distractor set).
- Set "roundType" to "tossup" or "bonus" correctly.
- Use the same "pairId" for the toss-up and its bonus. Pair IDs can be "1", "2", ... "${PAIR_COUNT}".

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
- roundType, pairId, type, question, options (4 strings), correctIndex (0–3), answer, topic (2–5 words labelling the concept), explanation (one short sentence).`;

    const { object } = await generateObject({
      model: openai(MODEL),
      schema: payloadSchema,
      system: appendOwnerStyleToSystem(baseSystem, ownerExtra),
      prompt: `Reading material (non-content / front-matter pages have already been removed where possible):\n${stripNonContentPages(accumulatedText).slice(0, 10000)}\n\n${
        notesContext ? `Session notes:\n${notesContext.slice(0, 3000)}` : ""
      }`,
    });

    const questions: VelocityQuestion[] = object.questions.map((q, i) => {
      const roundType = q.roundType ?? (i % 2 === 0 ? "tossup" : "bonus");
      const pairId = (q.pairId && q.pairId.trim()) || String(Math.floor(i / 2) + 1);
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
        });
      }
      return {
        roundType,
        pairId,
        type: "sa",
        question: q.question,
        answer: q.answer,
        topic: q.topic,
        explanation: q.explanation,
      };
    });

    const normalisedQuestions = questions
      .slice(0, DEFAULT_Q)
      .map((q, i) => ({
        ...q,
        roundType: i % 2 === 0 ? "tossup" : "bonus",
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

    return NextResponse.json({ id, questions: normalisedQuestions });
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
