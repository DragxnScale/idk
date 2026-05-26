import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getAppUser } from "@/lib/app-user";
import { openai, MODEL, isAiConfigured, wrapUntrusted, UNTRUSTED_INPUT_GUARD } from "@/lib/ai";
import { db } from "@/lib/db";
import { appendOwnerStyleToSystem, getAiOwnerStyleExtra } from "@/lib/app-settings";
import { quizzes, aiNotes, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { assertAiBudget, recordAiUsage } from "@/lib/ai-usage";
import { factCheckQuizQuestions } from "@/lib/ai-fact-check";

/** Allow up to 60s for slow OpenAI responses. See velocity/route.ts. */
export const maxDuration = 60;

// ── Constants ──────────────────────────────────────────────────────────
/** Hard ceiling on question count to avoid burning excessive tokens. */
const MAX_QUESTIONS = 25;
const DEFAULT_MIN = 3;
const DEFAULT_MAX = 10;

/** Phase-1 schema: questions only. Review is generated separately after
 *  the user completes the quiz so it can target wrong answers. */
const questionsSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()).length(4),
      correctIndex: z.number().int().min(0).max(3),
      explanation: z.string(),
    })
  ),
});

/** Fisher-Yates shuffle — shuffles options and adjusts correctIndex. */
function shuffleOptions(q: {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}) {
  const indices = [0, 1, 2, 3];
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return {
    question: q.question,
    options: indices.map((i) => q.options[i]),
    correctIndex: indices.indexOf(q.correctIndex),
    explanation: q.explanation,
  };
}

/** Count unique pages in the accumulated text (markers like "[Page 47]"). */
function countPages(text: string): number {
  const matches = text.match(/\[Page \d+\]/g);
  if (!matches) return 1;
  return new Set(matches).size;
}

export async function POST(request: Request) {
  const authUser = await getAppUser();
  if (!authUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI not configured. Set OPENAI_API_KEY in your environment." },
      { status: 503 }
    );
  }

  const overBudget = await assertAiBudget(authUser.id);
  if (overBudget) return overBudget;

  const body = await request.json();
  const { sessionId, accumulatedText } = body as {
    sessionId: string;
    accumulatedText: string;
  };

  if (!sessionId || !accumulatedText) {
    return NextResponse.json(
      { error: "sessionId and accumulatedText are required" },
      { status: 400 }
    );
  }

  // ── Load user quiz limits ────────────────────────────────────────────
  const row = await db.query.users.findFirst({
    where: eq(users.id, authUser.id),
  });
  const userMin = Math.max(1, row?.quizMinQuestions ?? DEFAULT_MIN);
  const userMax = Math.min(MAX_QUESTIONS, Math.max(userMin, row?.quizMaxQuestions ?? DEFAULT_MAX));

  // ── Calculate question count from pages read ─────────────────────────
  const pagesRead = countPages(accumulatedText);
  // 1.5 questions per page, clamped within user limits
  const targetQ = Math.max(userMin, Math.min(userMax, Math.round(pagesRead * 1.5)));

  // ── Build prompt ─────────────────────────────────────────────────────
  const existingNotes = await db.query.aiNotes.findMany({
    where: (n, { eq }) => eq(n.sessionId, sessionId),
  });
  const notesContext = existingNotes.map((n) => n.content).join("\n\n");
  const ownerExtra = await getAiOwnerStyleExtra();

  const baseSystem = `You are a study assistant creating an end-of-session quiz.

Generate exactly ${targetQ} multiple-choice questions testing comprehension of the reading material.

═══════════════════════════════════════════════════════════════════
STEP 0 — BUILD A COVERAGE CHECKLIST BEFORE WRITING ANY QUESTIONS
═══════════════════════════════════════════════════════════════════
Before writing a single question, mentally enumerate everything in the reading that belongs in the checklist below. THIS IS NOT OPTIONAL — it's the only way to avoid the failure mode of writing 6 questions on Boyle's law and 0 on Charles's law.

Checklist categories (build this list FIRST, then assign question slots):
1. **Every distinct formula / named equation.** Including the "obvious" ones the chapter introduces early. For a Zumdahl-style "gases" chapter that's at minimum:
   - PV = nRT  (ideal gas law)
   - P₁V₁ = P₂V₂ at constant n, T  (Boyle's law)
   - V₁/T₁ = V₂/T₂ at constant n, P  (Charles's law)
   - V₁/n₁ = V₂/n₂ at constant T, P  (Avogadro's law)
   - (P₁V₁)/(n₁T₁) = (P₂V₂)/(n₂T₂)  (combined gas law)
   - P_total = P_1 + P_2 + … = Σ P_i  (Dalton's law of partial pressures)
   - P_i = χ_i · P_total  (mole-fraction form of Dalton's law)
   - μ_rms = √(3RT/M)  (root-mean-square molecular speed, KMT)
   - KE_avg = (3/2)RT per mole  (translational KE from KMT)
   - rate_A / rate_B = √(M_B / M_A)  (Graham's law of effusion)
   - (P + a(n/V)²)(V − nb) = nRT  (van der Waals real-gas equation)
   - density d = PM/RT  (ideal-gas density)
   - molar mass M = dRT/P  (rearranged density form)
2. **Every named law, principle, theorem, or postulate** referenced in the reading (Boyle, Charles, Avogadro, Dalton, Graham, plus the postulates of the Kinetic Molecular Theory).
3. **Every core defined term** (partial pressure, mole fraction, ideal gas, real gas, effusion vs diffusion, root-mean-square speed, STP).
4. **Every conceptual relationship** (why real gases deviate from ideal at high P / low T, how molecular speed depends on T and M, what each van der Waals correction term physically represents).

If a checklist item is in the reading but you didn't write a question for it, you have failed the assignment. Bias HARD against revisiting a concept until every checklist item has a question.

═══════════════════════════════════════════════════════════════════
STEP 1 — SLOT ASSIGNMENT (this controls the question MIX)
═══════════════════════════════════════════════════════════════════
Of the ${targetQ} total questions, distribute slots roughly as follows:
- ~40% **plug-and-chug application questions** (described below). These are the highest-priority slots — fill them first.
- ~30% **formula identification / recognition** ("Which equation expresses Boyle's law?", "In PV = nRT, what does R represent?", "Which law relates volume to temperature at constant pressure?").
- ~20% **named-law / definition / vocabulary** questions.
- ~10% **conceptual cause-and-effect** questions ("Real gases deviate from ideal behaviour at … because …").

═══════════════════════════════════════════════════════════════════
STEP 2 — APPLICATION QUESTIONS (READ THIS CAREFULLY — this is where the prompt usually fails)
═══════════════════════════════════════════════════════════════════
An "application" question gives the student real numeric inputs and asks them to (a) pick the right formula and (b) compute a missing quantity. The four answer options are all the SAME unit and SHAPE — three are calculated wrong-but-plausible distractors, one is the correct value.

For a gases chapter the application slate MUST include questions structurally identical to these (use the chapter's own numbers, but follow the format exactly):

EXAMPLE application question on PV = nRT (find V):
  "A sample contains 0.500 mol of an ideal gas at 2.00 atm and 300. K. What is the volume? (R = 0.08206 L·atm/mol·K)"
  Options:
    "6.16 L"   ← correct: V = nRT/P = (0.500)(0.08206)(300)/2.00
    "12.3 L"   ← distractor: forgot to divide by P
    "3.08 L"   ← distractor: divided by 2P
    "24.6 L"   ← distractor: used T in °C without converting
  correctIndex points at "6.16 L"
  explanation: "Rearrange PV = nRT to V = nRT/P; with R = 0.08206 L·atm/mol·K and T in kelvin you get 6.16 L."

EXAMPLE application question on Boyle's law:
  "A 5.0 L sample of gas at 1.0 atm is compressed isothermally to 2.5 L. What is the new pressure?"
  Options: "2.0 atm" ← correct, "0.50 atm", "1.0 atm", "5.0 atm"

EXAMPLE application question on Charles's law (in K, not °C):
  "A balloon at 27 °C holds 1.00 L. What is the volume at 327 °C, pressure constant?"
  Options: "2.00 L" ← correct (300 K → 600 K, doubles), "1.00 L", "12 L" (used °C), "0.50 L"

EXAMPLE application question on Dalton's law (mole-fraction form):
  "A mixture of 2.0 mol N₂ and 3.0 mol O₂ exerts a total pressure of 5.0 atm. What is the partial pressure of O₂?"
  Options: "3.0 atm" ← correct (χ_O₂ = 3/5, P_O₂ = (3/5)(5.0) = 3.0), "2.0 atm", "5.0 atm", "1.5 atm"

EXAMPLE application question on Graham's law:
  "He effuses through a small hole how many times faster than O₂?"
  Options: "2.83" ← correct (√(32/4) = 2√2 ≈ 2.83), "8", "4", "1.41"

CRITICAL RULES for application questions:
- Use ROUND, MEMORABLE numbers a student would see in a Zumdahl problem set (1.0, 2.0, 5.0, 10. atm; 273 K, 300 K, 600 K; 1.00 L, 5.00 L, 22.4 L; 0.500 mol, 1.00 mol, 2.00 mol). NEVER fabricate "exotic" data points lifted from a specific worked example in the reading — that's banned (see "TEXTBOOK-SPECIFIC DATA POINTS" below). The numbers must be values you invent that any student could plug into the formula.
- ALWAYS include R (or the relevant constant) in the stem when needed: "(R = 0.08206 L·atm/mol·K)" so the student doesn't have to memorise it.
- ALWAYS include the unit in BOTH the stem and every option. All four options share the same unit.
- Distractors come from REAL student mistakes: forgot to convert °C → K, used wrong R, dropped a factor of 2, inverted the ratio, used °C absolutely.
- The explanation MUST name the formula and show the rearrangement: "PV = nRT, so V = nRT/P …".

═══════════════════════════════════════════════════════════════════
WHAT TO SKIP
═══════════════════════════════════════════════════════════════════
- Historical anecdotes, biographical trivia, dates, page numbers, chapter titles.
- The book's specific worked-example numbers (the data point version of "what was Q in this experiment?" — write a fresh problem with round numbers instead).
- Anything "interesting" but not on a typical unit test.

═══════════════════════════════════════════════════════════════════
COVERAGE CONSTRAINTS — SELF-CHECK BEFORE FINALISING
═══════════════════════════════════════════════════════════════════
Before you return the JSON, verify:
- [ ] Every formula in the Step-0 checklist that's in the reading has at least ONE question. If you have ${targetQ} slots and 8 formulas, you've covered at least 8 distinct formulas before any second question on a single formula.
- [ ] At least ⌈${targetQ} × 0.4⌉ of the questions are plug-and-chug application questions in the format shown above.
- [ ] You have NOT written more than 1 question on the same single law/concept (e.g. only one "Boyle's law" question — not three). The exception is when one is a recognition question and another is an application question on the same formula; that's allowed and encouraged.
- [ ] Pressure-unit / pressure-conversion questions (torr ↔ atm ↔ kPa ↔ mmHg) collectively take at most 1 slot. Pressure conversions are useful but not the centrepiece of the chapter.
- [ ] Each question's options share a unit and structural shape. Correct answer position is varied across the quiz.

═══════════════════════════════════════════════════════════════════
QUESTION QUALITY
═══════════════════════════════════════════════════════════════════
- Each question has exactly 4 answer options. Vary the correct answer's position.
- Distractors are *plausible* — common misconceptions, off-by-one mistakes, wrong unit/sign choices, forgetting °C→K. Never "all of the above" or joke options.
- Each question's "explanation" names the formula/law the question hinges on AND, for application questions, shows the rearrangement.
- Distribute questions across the chapter, not all on the first section.

For chapters with very few formulas, the rules collapse to: one definition per key term, then conceptual application questions. The application-slot rule still applies.`;

  const { object, usage } = await generateObject({
    model: openai(MODEL),
    schema: questionsSchema,
    system: appendOwnerStyleToSystem(baseSystem, ownerExtra) + UNTRUSTED_INPUT_GUARD,
    prompt: `Generate the quiz from the reading material below.\n\n${wrapUntrusted(
      "reading material",
      accumulatedText.slice(0, 30000)
    )}${
      notesContext
        ? `\n\n${wrapUntrusted("session notes", notesContext.slice(0, 3000))}`
        : ""
    }`,
  });
  await recordAiUsage(authUser.id, "/api/ai/quiz", usage);

  // ── Fact-check pass: drop unsupported questions, rewrite fixable ones.
  // Runs against the same source text + notes the generator saw. If the
  // verifier itself fails, returns the original list unchanged so we never
  // block on a broken verifier.
  const verifierSourceText =
    accumulatedText.slice(0, 30_000) +
    (notesContext ? `\n\n--- Session notes ---\n${notesContext.slice(0, 3000)}` : "");
  const {
    verified,
    dropped,
    fixed,
    usage: verifierUsage,
  } = await factCheckQuizQuestions(
    object.questions,
    verifierSourceText,
    ownerExtra
  );
  if (verifierUsage) {
    await recordAiUsage(authUser.id, "/api/ai/quiz/factcheck", verifierUsage);
  }
  if (dropped > 0 || fixed > 0) {
    console.log(
      `[ai/quiz] fact-check applied: ${fixed} fixed, ${dropped} dropped, ${verified.length} kept`
    );
  }

  // ── Shuffle answer options so correct index is randomised ────────────
  const questions = verified.map(shuffleOptions);

  // ── Persist (no review yet — generated after quiz completion) ────────
  const id = crypto.randomUUID();
  await db.insert(quizzes).values({
    id,
    sessionId,
    questionsJson: JSON.stringify(questions),
    reviewJson: null,
    totalQuestions: questions.length,
    createdAt: new Date(),
  });

  return NextResponse.json({ id, questions });
}

export async function GET(request: Request) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const quiz = await db.query.quizzes.findFirst({
    where: (q, { eq }) => eq(q.sessionId, sessionId),
  });

  if (!quiz) {
    return NextResponse.json({ error: "No quiz found for this session" }, { status: 404 });
  }

  return NextResponse.json({
    id: quiz.id,
    sessionId: quiz.sessionId,
    questions: JSON.parse(quiz.questionsJson),
    review: quiz.reviewJson ? JSON.parse(quiz.reviewJson) : null,
    score: quiz.score,
    totalQuestions: quiz.totalQuestions,
  });
}
