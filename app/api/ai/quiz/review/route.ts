/**
 * POST /api/ai/quiz/review
 *
 * Called after the user finishes the quiz. Generates review material
 * targeted at the questions the user got wrong. If the user scored
 * 100 % there are no wrong answers, so we return a perfect-score
 * celebration with empty review lists — no AI call needed.
 */

import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { openai, MODEL, isAiConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { appendOwnerStyleToSystem, getAiOwnerStyleExtra } from "@/lib/app-settings";
import { quizzes } from "@/lib/db/schema";

interface WrongQuestion {
  question: string;
  correctAnswer: string;
  explanation: string;
}

const reviewSchema = z.object({
  thingsToReview: z.array(z.string()).min(1).max(8),
  videoSuggestions: z.array(
    z.object({
      title: z.string(),
      searchQuery: z.string(),
    })
  ).min(1).max(4),
});

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as {
    quizId: string;
    score: number;
    totalQuestions: number;
    wrongQuestions: WrongQuestion[];
  };

  const { quizId, score, totalQuestions, wrongQuestions } = body;

  if (!quizId) {
    return NextResponse.json({ error: "quizId is required" }, { status: 400 });
  }

  // ── Perfect score: no AI call needed ────────────────────────────────
  if (!wrongQuestions || wrongQuestions.length === 0) {
    const perfectReview = {
      perfect: true,
      thingsToReview: [],
      videoSuggestions: [],
    };
    await db
      .update(quizzes)
      .set({ score, reviewJson: JSON.stringify(perfectReview) })
      .where(eq(quizzes.id, quizId));
    return NextResponse.json(perfectReview);
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI not configured. Set OPENAI_API_KEY in your environment." },
      { status: 503 }
    );
  }

  // ── Generate targeted review for wrong answers ───────────────────────
  const ownerExtra = await getAiOwnerStyleExtra();
  const wrongSummary = wrongQuestions
    .map((w, i) => `${i + 1}. "${w.question}"\n   Correct answer: ${w.correctAnswer}\n   Explanation: ${w.explanation}`)
    .join("\n\n");

  const baseSystem = `You are a study assistant generating targeted review material.
The student just completed a quiz and got ${wrongQuestions.length} out of ${totalQuestions} question${totalQuestions !== 1 ? "s" : ""} wrong.

Based ONLY on the questions they got wrong, generate:
1. thingsToReview: ${Math.min(wrongQuestions.length + 1, 6)} specific topics or concepts the student should revisit to understand why they got those questions wrong. Be direct and actionable.
2. videoSuggestions: ${Math.min(wrongQuestions.length, 3)} YouTube search queries — one per distinct weak area. Include subject + concept + "explained" or "tutorial" (e.g. "mitosis phases biology explained"). Only suggest videos for the specific gaps identified.

Do not add review items for topics the student already demonstrated they understand.`;

  const { object } = await generateObject({
    model: openai(MODEL),
    schema: reviewSchema,
    system: appendOwnerStyleToSystem(baseSystem, ownerExtra),
    prompt: `Questions the student answered incorrectly:\n\n${wrongSummary}`,
  });

  const review = { perfect: false, ...object };

  await db
    .update(quizzes)
    .set({ score, reviewJson: JSON.stringify(review) })
    .where(eq(quizzes.id, quizId));

  return NextResponse.json(review);
}
