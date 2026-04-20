import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { openai, MODEL, isAiConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { appendOwnerStyleToSystem, getAiOwnerStyleExtra } from "@/lib/app-settings";
import { velocityGames } from "@/lib/db/schema";

const attemptSchema = z.object({
  topic: z.string(),
  question: z.string(),
  userAnswer: z.string().optional(),
  correctAnswer: z.string(),
  correct: z.boolean(),
  reactionMs: z.number().int().min(0).nullable(),
  type: z.enum(["mc", "sa"]),
});

const bodySchema = z.object({
  velocityGameId: z.string(),
  attempts: z.array(attemptSchema).min(1),
});

const reviewSchema = z.object({
  growthAreas: z
    .array(
      z.object({
        topic: z.string(),
        tip: z.string(),
      })
    )
    .max(5),
  videoSuggestions: z
    .array(
      z.object({
        title: z.string(),
        searchQuery: z.string(),
        reason: z.string(),
      })
    )
    .max(4),
});

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { velocityGameId, attempts } = parsed.data;

  const game = await db.query.velocityGames.findFirst({
    where: (g, { eq }) => eq(g.id, velocityGameId),
  });
  if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });

  const total = attempts.length;
  const correctCount = attempts.filter((a) => a.correct).length;
  const accuracy = Math.round((correctCount / total) * 100);
  const reactions = attempts
    .map((a) => a.reactionMs)
    .filter((n): n is number => typeof n === "number");
  const avgReactionMs = reactions.length
    ? Math.round(reactions.reduce((s, n) => s + n, 0) / reactions.length)
    : null;
  const fastestMs = reactions.length ? Math.min(...reactions) : null;
  const slowestMs = reactions.length ? Math.max(...reactions) : null;

  const resultsPayload = {
    attempts,
    accuracy,
    correctCount,
    total,
    avgReactionMs,
    fastestMs,
    slowestMs,
  };

  let review: z.infer<typeof reviewSchema> | null = null;
  if (isAiConfigured()) {
    const wrong = attempts.filter((a) => !a.correct);
    const ownerExtra = await getAiOwnerStyleExtra();
    const summary = attempts
      .map(
        (a) =>
          `- [${a.topic}] ${a.correct ? "✓" : "✗"} Q: ${a.question} | correct: ${
            a.correctAnswer
          }${a.userAnswer ? ` | user: ${a.userAnswer}` : " | user: (no answer)"}`
      )
      .join("\n");

    const baseSystem = `You are writing a concise post-game review for a rapid-fire reaction quiz.
Produce:
  - growthAreas: up to 5 items. Pick the topics the learner struggled with most (based on wrong answers or slow reactions). Each item has a short topic name and a one-sentence concrete tip to improve.
  - videoSuggestions: up to 4 YouTube search queries that would help shore up the growth areas. Each has a punchy title, a searchQuery, and a one-line reason. If the learner got everything right, suggest videos that extend or deepen the strongest topics.
Keep everything short and actionable. No filler.`;

    try {
      const { object } = await generateObject({
        model: openai(MODEL),
        schema: reviewSchema,
        system: appendOwnerStyleToSystem(baseSystem, ownerExtra),
        prompt: `Accuracy: ${accuracy}% (${correctCount}/${total}). Avg reaction: ${
          avgReactionMs ?? "n/a"
        } ms.\n\nAttempts:\n${summary}\n\nWrong answers: ${wrong.length}.`,
      });
      review = object;
    } catch {
      review = null;
    }
  }

  await db
    .update(velocityGames)
    .set({
      resultsJson: JSON.stringify(resultsPayload),
      reviewJson: review ? JSON.stringify(review) : null,
      accuracy,
      avgReactionMs,
      completedAt: new Date(),
    })
    .where(eq(velocityGames.id, velocityGameId));

  return NextResponse.json({
    accuracy,
    avgReactionMs,
    fastestMs,
    slowestMs,
    correctCount,
    total,
    review,
  });
}
