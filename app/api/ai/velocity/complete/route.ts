import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { openai, MODEL, isAiConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { appendOwnerStyleToSystem, getAiOwnerStyleExtra } from "@/lib/app-settings";
import { clientErrorLogs, velocityGames } from "@/lib/db/schema";
import { assertAiBudget, recordAiUsage } from "@/lib/ai-usage";

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
      message: `[velocity/complete] ${message}`.slice(0, 4000),
      stack: stack?.slice(0, 32000) ?? null,
      url: null,
      userAgent: null,
      extra: extraJson,
    });
  } catch {
    /* logging must never throw */
  }
}

const attemptSchema = z.object({
  topic: z.string(),
  question: z.string(),
  userAnswer: z.string().optional(),
  correctAnswer: z.string(),
  correct: z.boolean(),
  reactionMs: z.number().int().min(0).nullable(),
  type: z.enum(["mc", "sa"]),
  roundType: z.enum(["tossup", "bonus"]).optional(),
  /** True if the user buzzed before the stem finished typing. */
  interrupt: z.boolean().optional(),
  /** Grader explanation (SA) surfaced on the results review. */
  graderReason: z.string().optional(),
  /** One-sentence concept explanation from the generator. */
  explanation: z.string().optional(),
  /** Optional. If omitted the server recomputes using the scoring rules below. */
  points: z.number().int().optional(),
  /** Whether the user buzzed at all (distinguishes timeout vs wrong). */
  buzzed: z.boolean().optional(),
});

const bodySchema = z.object({
  velocityGameId: z.string(),
  attempts: z.array(attemptSchema).min(1),
});

/**
 * NSB-inspired scoring:
 *  - Correct toss-up: +4 points
 *  - Correct bonus: +10 points
 *  - Wrong answer after buzzing IN the stem (interrupt / neg): -4
 *  - Wrong answer after hearing the full stem (and options, if MC): 0
 *  - Never buzzed (timeout): 0
 */
function scoreAttempt(a: z.infer<typeof attemptSchema>, index: number): number {
  const roundType = a.roundType ?? (index % 2 === 0 ? "tossup" : "bonus");
  if (a.correct) return roundType === "tossup" ? 4 : 10;
  if (a.interrupt && a.buzzed !== false) return -4;
  return 0;
}

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

  const sessionOk = await db.query.studySessions.findFirst({
    where: (s, { and: a, eq: e }) =>
      a(e(s.id, game.sessionId), e(s.userId, user.id)),
    columns: { id: true },
  });
  if (!sessionOk) {
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  }

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

  // Server-side scoring: recompute points for every attempt so the client can't
  // forge them, and track the longest streak + number of negs.
  const scored = attempts.map((a, index) => ({
    ...a,
    roundType: a.roundType ?? (index % 2 === 0 ? "tossup" : "bonus"),
    points: scoreAttempt(a, index),
  }));
  const score = scored.reduce((s, a) => s + a.points, 0);
  const negCount = scored.filter((a) => a.points < 0).length;
  const bonusSeen = scored.filter((a) => a.roundType === "bonus").length;
  const bonusCorrect = scored.filter((a) => a.roundType === "bonus" && a.correct).length;
  const bonusConversionRate = bonusSeen > 0 ? Math.round((bonusCorrect / bonusSeen) * 100) : 0;
  let streakBest = 0;
  let streakCur = 0;
  for (const a of scored) {
    if (a.correct) {
      streakCur += 1;
      if (streakCur > streakBest) streakBest = streakCur;
    } else {
      streakCur = 0;
    }
  }

  const resultsPayload = {
    attempts: scored,
    accuracy,
    correctCount,
    total,
    avgReactionMs,
    fastestMs,
    slowestMs,
    score,
    negCount,
    streakBest,
    bonusSeen,
    bonusCorrect,
    bonusConversionRate,
  };

  let review: z.infer<typeof reviewSchema> | null = null;
  // Skip the AI review step (not the whole completion) when over budget —
  // scoring + stats still persist, just the review is left null.
  const reviewOverBudget = isAiConfigured() ? await assertAiBudget(user.id) : null;
  if (isAiConfigured() && !reviewOverBudget) {
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
      const { object, usage } = await generateObject({
        model: openai(MODEL),
        schema: reviewSchema,
        system: appendOwnerStyleToSystem(baseSystem, ownerExtra),
        prompt: `Accuracy: ${accuracy}% (${correctCount}/${total}). Avg reaction: ${
          avgReactionMs ?? "n/a"
        } ms.\n\nAttempts:\n${summary}\n\nWrong answers: ${wrong.length}.`,
      });
      await recordAiUsage(user.id, "/api/ai/velocity/complete", usage);
      review = object;
    } catch (err) {
      await logServerFailure(user.id, user.email ?? null, err, {
        route: "POST /api/ai/velocity/complete (review step)",
        velocityGameId,
        accuracy,
      });
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
    score,
    negCount,
    streakBest,
    bonusSeen,
    bonusCorrect,
    bonusConversionRate,
    attempts: scored,
    review,
  });
}
