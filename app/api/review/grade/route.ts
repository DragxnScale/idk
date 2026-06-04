/**
 * Grade a single card: persist the new FSRS schedule.
 *
 *   POST /api/review/grade
 *   body: { cardId: string, grade: 1 | 2 | 3 | 4 }   // Again | Hard | Good | Easy
 *   →
 *   { card: { id, srsState, stability, difficulty, dueAt, lapses, reps, learningSteps, intervalDays } }
 *
 * Server flow:
 *   1. Verify the card exists and belongs to the calling user (via the
 *      flashcards → study_sessions → user_id chain).
 *   2. Read current SRS state, run `scheduleNext()`, get the new state.
 *   3. UPDATE the seven SRS columns.
 *   4. Return the updated state so the client can render "next review
 *      in 4d" feedback briefly.
 *
 * No transactions / no read-modify-write race protection — flashcard
 * grading is a single-user-driven action; double-grading the same card
 * would just re-compute the schedule twice and the second result wins.
 * Cheap to leave un-locked.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { flashcards, studySessions } from "@/lib/db/schema";
import {
  Grade,
  scheduleNext,
  type FlashcardSrsState,
  type GradeValue,
} from "@/lib/srs";

export const runtime = "nodejs";

const VALID_GRADES = new Set<number>([Grade.Again, Grade.Hard, Grade.Good, Grade.Easy]);

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { cardId?: string; grade?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const cardId = typeof body.cardId === "string" ? body.cardId : null;
  const grade = typeof body.grade === "number" ? body.grade : null;

  if (!cardId) {
    return NextResponse.json({ error: "cardId is required" }, { status: 400 });
  }
  if (grade == null || !VALID_GRADES.has(grade)) {
    return NextResponse.json(
      { error: "grade must be 1 (Again), 2 (Hard), 3 (Good), or 4 (Easy)" },
      { status: 400 }
    );
  }

  // Verify ownership in the same query.
  const rows = await db
    .select({
      card: flashcards,
      sessionUserId: studySessions.userId,
    })
    .from(flashcards)
    .innerJoin(studySessions, eq(studySessions.id, flashcards.sessionId))
    .where(eq(flashcards.id, cardId))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }
  const { card, sessionUserId } = rows[0];
  if (sessionUserId !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const currentState: FlashcardSrsState = {
    srsState: card.srsState,
    stability: card.stability,
    difficulty: card.difficulty,
    dueAt: card.dueAt ?? null,
    lastReviewedAt: card.lastReviewedAt ?? null,
    lapses: card.lapses,
    reps: card.reps,
    learningSteps: card.learningSteps,
  };

  const now = new Date();
  const result = scheduleNext(currentState, grade as GradeValue, now);

  await db
    .update(flashcards)
    .set({
      srsState: result.state.srsState,
      stability: result.state.stability,
      difficulty: result.state.difficulty,
      dueAt: result.state.dueAt,
      lastReviewedAt: result.state.lastReviewedAt,
      lapses: result.state.lapses,
      reps: result.state.reps,
      learningSteps: result.state.learningSteps,
    })
    .where(eq(flashcards.id, cardId));

  return NextResponse.json({
    card: {
      id: cardId,
      srsState: result.state.srsState,
      stability: result.state.stability,
      difficulty: result.state.difficulty,
      dueAt: result.state.dueAt?.getTime() ?? null,
      lastReviewedAt: result.state.lastReviewedAt?.getTime() ?? null,
      lapses: result.state.lapses,
      reps: result.state.reps,
      learningSteps: result.state.learningSteps,
      intervalDays: result.intervalDays,
    },
  });
}
