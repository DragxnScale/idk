/**
 * Record a `/review` session as a `study_sessions` row so it counts
 * toward the daily streak.
 *
 *   POST /api/review/session
 *   body: { startedAt: number, endedAt: number, cardsReviewed: number }
 *   →
 *   { id, totalFocusedMinutes }
 *
 * Why a synthetic row instead of a separate table:
 *
 * The streak calculation in `/api/study/stats` walks `study_sessions`
 * day-by-day. A separate `review_sessions` table would require
 * forking that calculation. Inserting one row per review session is
 * one line of code and the streak code stays untouched. The
 * `goal_type = "review"` discriminator (existing values are "time"
 * and "chapter") lets admin analytics filter these out if needed.
 *
 * Idempotency: the client sends one POST when the review session
 * ends. Visiting `/review` and immediately leaving without grading
 * any cards does NOT post — the page only fires this when at least
 * one card was graded, so empty review visits don't count toward
 * the streak.
 */
import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { studySessions } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    startedAt?: number;
    endedAt?: number;
    cardsReviewed?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const startedAt = typeof body.startedAt === "number" ? body.startedAt : Date.now();
  const endedAt = typeof body.endedAt === "number" ? body.endedAt : Date.now();
  const cardsReviewed = Math.max(0, Number(body.cardsReviewed) || 0);

  if (cardsReviewed === 0) {
    // Don't pollute the streak record with empty review visits.
    return NextResponse.json({ skipped: true });
  }

  const elapsedMin = Math.max(
    1,
    Math.round((endedAt - startedAt) / 60_000)
  );

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(studySessions).values({
    id,
    userId: user.id,
    goalType: "review",
    // `targetValue` is required-not-null on the schema. Using
    // `cardsReviewed` so admin analytics can see the work output
    // even though it's not a goal in the conventional sense.
    targetValue: cardsReviewed,
    startedAt: new Date(startedAt),
    endedAt: new Date(endedAt),
    totalFocusedMinutes: elapsedMin,
    createdAt: now,
    sessionState: "live",
  });

  return NextResponse.json({ id, totalFocusedMinutes: elapsedMin });
}
