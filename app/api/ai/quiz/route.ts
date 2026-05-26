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

WHAT TO ASK ABOUT (in priority order — fill the easier categories first, then move on)
1. **Formulas and named equations.** Every formula, law, or named equation in the reading must be tested at least once before any topic is repeated. For each formula:
   - Identify it (recognise the equation, name what each variable means, state the law it expresses).
   - Apply it (plug-and-chug or rearrangement — what happens to the answer when one variable doubles, what units come out, which formula fits a given scenario).
   For a chemistry "gases" chapter that means PV = nRT, P₁V₁ = P₂V₂, V₁/T₁ = V₂/T₂, P_total = ΣP_i, μ_rms = √(3RT/M), the van der Waals correction (P + a(n/V)²)(V − nb) = nRT, etc.
2. **Named laws, principles, and theories.** Boyle's, Charles's, Avogadro's, Dalton's, Graham's, Hess's, Le Chatelier's, Hund's, Pauli, Aufbau, the Kinetic Molecular Theory, etc. Each must appear if the reading covers it.
3. **Core definitions and operational vocabulary.** Terms a student must own before they can think about the topic at all (e.g. partial pressure, mole fraction, ideal gas, root-mean-square velocity, effusion vs diffusion). Use distractors that are nearby/confusable terms from the same chapter.
4. **Cause-and-effect relationships and conditions.** When does Boyle's law fail? Why do real gases deviate at high pressure? What makes a gas "ideal"?

WHAT TO SKIP unless the reading explicitly emphasises it:
- Historical anecdotes, biographical trivia, dates, page numbers, chapter titles.
- Side examples that aren't tied to a core concept.
- Anything that's "interesting" but not on a typical unit test.

QUESTION QUALITY
- Each question has exactly 4 answer options. Vary the position of the correct answer across the quiz — do NOT always put it first.
- Distractors are *plausible* — pull them from related concepts, common misconceptions, off-by-one mistakes, or wrong unit/sign choices. Never use "all of the above" or joke options.
- Test understanding and application, not surface recall. A question like "What is PV = nRT called?" is weaker than "If you triple the moles of gas in a sealed rigid container at constant temperature, what happens to the pressure?"
- Each question gets a one-sentence "explanation" that names the formula/law/principle the question hinges on, so the review screen reinforces the concept.
- Distribute questions across topics so the quiz covers the whole reading, not just one section.

For chapters that have very few formulas, the rules collapse to: one definition per key term, then conceptual application questions.`;

  const { object, usage } = await generateObject({
    model: openai(MODEL),
    schema: questionsSchema,
    system: appendOwnerStyleToSystem(baseSystem, ownerExtra) + UNTRUSTED_INPUT_GUARD,
    prompt: `Generate the quiz from the reading material below.\n\n${wrapUntrusted(
      "reading material",
      accumulatedText.slice(0, 10000)
    )}${
      notesContext
        ? `\n\n${wrapUntrusted("session notes", notesContext.slice(0, 3000))}`
        : ""
    }`,
  });
  await recordAiUsage(authUser.id, "/api/ai/quiz", usage);

  // ── Shuffle answer options so correct index is randomised ────────────
  const questions = object.questions.map(shuffleOptions);

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
