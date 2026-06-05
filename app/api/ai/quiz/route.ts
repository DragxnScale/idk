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
SUBJECT-AGNOSTIC: these rules apply to ANY subject
═══════════════════════════════════════════════════════════════════
Chemistry, biology, physics, mathematics, computer science, economics, history, literature — same workflow regardless. The concrete examples below are drawn from a chemistry "gases" chapter because the prompt was tuned against that case, but the rules are domain-neutral. For a biology cell-respiration chapter your checklist items would be glycolysis, Krebs cycle, electron transport chain, ATP yields, oxidative phosphorylation, etc.; for a calculus chapter they'd be the power rule, chain rule, fundamental theorem, definite vs indefinite integrals, etc.; for a history chapter they'd be each named treaty, war, doctrine, person. Translate every "formula" rule below to "named theorem / process / event / canonical fact" for non-quantitative subjects.

═══════════════════════════════════════════════════════════════════
STEP 0 — BUILD A COVERAGE CHECKLIST BEFORE WRITING ANY QUESTIONS
═══════════════════════════════════════════════════════════════════
Before writing a single question, mentally enumerate everything in the reading that belongs in the checklist below. THIS IS NOT OPTIONAL — it's the only way to avoid the failure mode of writing 6 questions on the first concept and 0 on later ones.

Checklist categories (build this list FIRST, then assign question slots):
1. **Every distinct formula / named equation / named result.** Including ones the chapter introduces "in passing". The handful below are illustrative for a chemistry "gases" chapter — for any other subject, replace them with that subject's named formulas, theorems, processes, or canonical procedures.
   ILLUSTRATIVE (chemistry, gases):
   - PV = nRT  (ideal gas law)
   - P₁V₁ = P₂V₂  (Boyle's law)
   - V₁/T₁ = V₂/T₂  (Charles's law)
   - V₁/n₁ = V₂/n₂  (Avogadro's law)
   - (P₁V₁)/(n₁T₁) = (P₂V₂)/(n₂T₂)  (combined gas law)
   - P_total = Σ P_i  (Dalton's law)
   - P_i = χ_i · P_total  (mole-fraction form)
   - μ_rms = √(3RT/M)  (KMT rms speed)
   - KE_avg = (3/2)RT  (KMT kinetic energy)
   - rate_A / rate_B = √(M_B / M_A)  (Graham's law)
   - (P + a(n/V)²)(V − nb) = nRT  (van der Waals)
   - d = PM/RT  (gas density)
   ILLUSTRATIVE (calculus): power rule, product rule, quotient rule, chain rule, FTC parts I and II, u-substitution, integration by parts, the limit definition of the derivative.
   ILLUSTRATIVE (cellular biology): glycolysis steps, Krebs cycle, electron transport chain, ATP yields per pathway, fermentation, aerobic vs anaerobic, oxidative phosphorylation.
   ILLUSTRATIVE (US history WWII): each named conference (Yalta, Potsdam), each named operation (Overlord, Market Garden), each treaty, each major doctrine.
2. **Every named law, principle, theorem, postulate, or model** referenced in the reading.
3. **Every core defined term / piece of operational vocabulary** the chapter uses.
4. **Every conceptual cause-and-effect / conditions** the chapter establishes (when X applies, when X fails, why X behaves the way it does).

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
An "application" question puts the student in the position of having to (a) pick the right tool from the chapter — formula, theorem, procedure, framework, identification rule — and (b) actually use it on concrete inputs to produce an answer. The four answer options share the same unit / shape — three are plausible-but-wrong, one is correct.

For QUANTITATIVE chapters (chemistry, physics, math, econ, anything with formulas), application questions give numeric inputs and ask for a computed missing quantity:

EXAMPLE — chemistry, PV = nRT (find V):
  "A sample contains 0.500 mol of an ideal gas at 2.00 atm and 300. K. What is the volume? (R = 0.08206 L·atm/mol·K)"
  Options: "6.16 L" ← correct (V = nRT/P), "12.3 L" (forgot to divide by P), "3.08 L" (divided by 2P), "24.6 L" (used T in °C)
  explanation: "Rearrange PV = nRT to V = nRT/P; with R = 0.08206 L·atm/mol·K and T in kelvin you get 6.16 L."

EXAMPLE — physics kinematics:
  "A car accelerates from rest at 3.0 m/s² for 4.0 s. How far does it travel?"
  Options: "24 m" ← correct (½ a t² = ½·3·16), "12 m", "48 m", "6 m"

EXAMPLE — calculus, chain rule:
  "If f(x) = sin(3x²), what is f'(x)?"
  Options: "6x · cos(3x²)" ← correct, "cos(3x²)", "6x · sin(3x²)", "3x² · cos(3x²)"

EXAMPLE — biology, Punnett-square ratios:
  "Two heterozygous parents (Aa × Aa) cross. What fraction of offspring are expected to be homozygous recessive?"
  Options: "1/4" ← correct, "1/2", "3/4", "1/3"

EXAMPLE — statistics, z-score:
  "A score of 78 on an exam with mean 70 and standard deviation 4. What is the z-score?"
  Options: "2.0" ← correct, "0.5", "8", "1.0"

For QUALITATIVE chapters (history, literature, pure-vocabulary biology), an "application" question still requires the student to *apply* the chapter's framework rather than recall a definition:

EXAMPLE — history, Cold War:
  "Which Cold War doctrine would best justify U.S. intervention to prevent a single country from falling to communism for fear neighbouring countries would follow?"
  Options: "domino theory" ← correct, "Truman Doctrine", "containment", "Monroe Doctrine"

EXAMPLE — literature, identifying a device:
  "'The wind whispered through the trees' is an example of which figure of speech?"
  Options: "personification" ← correct, "simile", "hyperbole", "alliteration"

CRITICAL RULES for application questions (apply to all subjects):
- Use ROUND, MEMORABLE numbers (1.0, 2.0, 5.0, 10 atm; 273 K, 300 K, 600 K; 1.00 L, 22.4 L; 0.500 mol; in calculus: x = 0, 1, 2, 3, 4; in stats: σ = 1, 2, 4). NEVER lift "exotic" data points from a specific worked example or graph in the reading — that's banned (see "TEXTBOOK-SPECIFIC DATA POINTS" below). The numbers must be values you invent that any student could plug in.
- ALWAYS include any constants the student would need but might forget in the stem itself (e.g. "R = 0.08206 L·atm/mol·K", "g = 9.8 m/s²", "c = 3 × 10⁸ m/s"). The student should never have to re-derive a memorised constant.
- ALWAYS include the unit in BOTH the stem and every option. All four options share the same unit / shape.
- Distractors come from REAL student mistakes: forgot to convert (°C → K, ° → rad), used wrong constant, dropped a factor, inverted the ratio, misapplied the chain rule, off-by-one indexing.
- The explanation MUST name the formula / theorem / framework the question hinges on, and for computed answers, show the rearrangement: "PV = nRT, so V = nRT/P …" or "By the chain rule, d/dx[sin(u)] = cos(u)·u' …".

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
- [ ] Every checklist item from Step 0 that's in the reading has at least ONE question. If you have ${targetQ} slots and 8 checklist items, you've covered at least 8 distinct items before any second question on a single one.
- [ ] At least ⌈${targetQ} × 0.4⌉ of the questions are plug-and-chug application questions in the format shown above (or the qualitative-application format for non-quantitative chapters).
- [ ] You have NOT written more than 1 question on the same single law/concept/formula. The exception is when one is a recognition question and another is an application question on the same formula; that's allowed and encouraged.
- [ ] Any single niche-conversion category (e.g. pressure-unit conversions in chemistry: torr ↔ atm ↔ mmHg ↔ kPa; or unit prefix conversions in physics: kilo / milli / micro; or date-arithmetic in history) collectively takes at most 1 slot. Useful but never the centrepiece of a chapter.
- [ ] Each question's options share a unit and structural shape. Correct answer position is varied across the quiz.

═══════════════════════════════════════════════════════════════════
QUESTION QUALITY
═══════════════════════════════════════════════════════════════════
- Each question has exactly 4 answer options. Vary the correct answer's position.
- Distractors are *plausible* — common misconceptions, off-by-one mistakes, wrong unit/sign choices, forgetting °C→K. Never "all of the above" or joke options.
- Each question's "explanation" names the formula/law the question hinges on AND, for application questions, shows the rearrangement.
- Distribute questions across the chapter, not all on the first section.

For chapters with very few formulas, the rules collapse to: one definition per key term, then conceptual application questions. The application-slot rule still applies.`;

  const quizPrompt = `Generate the quiz from the reading material below.\n\n${wrapUntrusted(
    "reading material",
    accumulatedText.slice(0, 30000)
  )}${
    notesContext
      ? `\n\n${wrapUntrusted("session notes", notesContext.slice(0, 3000))}`
      : ""
  }`;
  const { object, usage } = await generateObject({
    model: openai(MODEL),
    schema: questionsSchema,
    system: appendOwnerStyleToSystem(baseSystem, ownerExtra) + UNTRUSTED_INPUT_GUARD,
    prompt: quizPrompt,
  });
  await recordAiUsage(authUser.id, "/api/ai/quiz", usage, {
    inputText: quizPrompt,
    outputText: JSON.stringify(object, null, 2),
  });

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
    await recordAiUsage(authUser.id, "/api/ai/quiz/factcheck", verifierUsage, {
      inputText: verifierSourceText,
      outputText: JSON.stringify({ dropped, fixed, questions: verified }, null, 2),
    });
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
