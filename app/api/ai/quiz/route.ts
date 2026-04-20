import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getAppUser } from "@/lib/app-user";
import { openai, MODEL, isAiConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { appendOwnerStyleToSystem, getAiOwnerStyleExtra } from "@/lib/app-settings";
import { quizzes, aiNotes, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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
- Prioritise the most essential, examinable concepts: core definitions, key principles, fundamental relationships, and must-know processes. Skip trivia, historical anecdotes, and fun facts unless they are directly tied to a core concept.
- Each question must have exactly 4 answer options.
- Vary the correct answer position across questions — do NOT always put the correct answer first.
- Include one correct answer (correctIndex 0-3) and a brief explanation for each question.
- Distribute questions evenly across all the major topics in the reading.
- Questions should test understanding and application, not just surface recall.`;

  const { object } = await generateObject({
    model: openai(MODEL),
    schema: questionsSchema,
    system: appendOwnerStyleToSystem(baseSystem, ownerExtra),
    prompt: `Reading material:\n${accumulatedText.slice(0, 10000)}\n\n${
      notesContext ? `Session notes:\n${notesContext.slice(0, 3000)}` : ""
    }`,
  });

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
