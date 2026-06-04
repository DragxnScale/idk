/**
 * Spaced-repetition review queue.
 *
 *   GET /api/review/queue?limit=50
 *   →
 *   {
 *     cards: [
 *       { id, front, back, pageNumber, srsState, dueAt, deckTitle, ...srsState },
 *       ...
 *     ],
 *     queueSize: 47,        // total cards due now or in the next 10 minutes
 *     newRemainingToday: 12, // cap left after today's introduced new cards
 *     reviewsRemainingToday: 188,
 *   }
 *
 * Only returns cards owned by the calling user (joined through
 * study_sessions). Cards are ordered:
 *   1. Learning / Relearning state, due first (sub-day intervals — these
 *      are "show me again in this same session" cards).
 *   2. Review state, oldest due_at first (most overdue cards win).
 *   3. New state, in arbitrary order, capped by srs_new_per_day.
 *
 * The 10-minute look-ahead matters: when the user grades a card "Again"
 * the new due_at is `now + 1min`. The next refill must include that
 * card or the queue empties prematurely.
 */
import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const DEFAULT_NEW_PER_DAY = 20;
const DEFAULT_REVIEWS_PER_DAY = 200;
const RELEARNING_LOOKAHEAD_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(request: Request) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 200);

  const now = Date.now();
  const lookahead = now + RELEARNING_LOOKAHEAD_MS;

  // ── Per-user pacing caps ─────────────────────────────────────────
  const userRow = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, user.id),
    columns: { srsNewPerDay: true, srsReviewsPerDay: true },
  });
  const newCap = userRow?.srsNewPerDay ?? DEFAULT_NEW_PER_DAY;
  const reviewsCap = userRow?.srsReviewsPerDay ?? DEFAULT_REVIEWS_PER_DAY;

  // Day boundary in user-server local time. SQLite stores `last_reviewed_at`
  // as a unix-second integer (drizzle timestamp mode). We use UTC midnight
  // for the cutoff — close enough; per-timezone day boundaries aren't worth
  // the complexity for v1 (Anki uses an arbitrary 4 AM cutoff for the same
  // reason).
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartSec = Math.floor(todayStart.getTime() / 1000);

  // Count "new cards introduced today" = cards whose first grade landed
  // today. `reps = 1` AND `last_reviewed_at >= today` is the canonical
  // signal — `reps` jumps from 0 to 1 on the very first grade.
  const newTodayRow = await db.$client.execute({
    sql: `
      SELECT COUNT(*) AS n
      FROM flashcards f
      INNER JOIN study_sessions ss ON ss.id = f.session_id
      WHERE ss.user_id = ?
        AND f.reps = 1
        AND f.last_reviewed_at >= ?
    `,
    args: [user.id, todayStartSec],
  });
  const newToday = Number(newTodayRow.rows[0]?.n ?? 0);
  const newRemainingToday = Math.max(0, newCap - newToday);

  const reviewsTodayRow = await db.$client.execute({
    sql: `
      SELECT COUNT(*) AS n
      FROM flashcards f
      INNER JOIN study_sessions ss ON ss.id = f.session_id
      WHERE ss.user_id = ?
        AND f.last_reviewed_at >= ?
    `,
    args: [user.id, todayStartSec],
  });
  const reviewsToday = Number(reviewsTodayRow.rows[0]?.n ?? 0);
  const reviewsRemainingToday = Math.max(0, reviewsCap - reviewsToday);

  if (reviewsRemainingToday === 0) {
    return NextResponse.json({
      cards: [],
      queueSize: 0,
      newRemainingToday,
      reviewsRemainingToday: 0,
      capReached: true,
    });
  }

  // ── Total queue size (excluding the new-card excess) ─────────────
  // Counts:
  //   - all Learning / Relearning cards due within the lookahead window
  //   - all Review cards due now
  // Doesn't add new-card count yet because that's capped separately.
  const lookaheadSec = Math.floor(lookahead / 1000);
  const nowSec = Math.floor(now / 1000);

  const dueScheduledRow = await db.$client.execute({
    sql: `
      SELECT COUNT(*) AS n
      FROM flashcards f
      INNER JOIN study_sessions ss ON ss.id = f.session_id
      WHERE ss.user_id = ?
        AND (
          (f.srs_state IN (1, 3) AND f.due_at IS NOT NULL AND f.due_at <= ?)
          OR
          (f.srs_state = 2 AND f.due_at IS NOT NULL AND f.due_at <= ?)
        )
    `,
    args: [user.id, lookaheadSec, nowSec],
  });
  const dueScheduled = Number(dueScheduledRow.rows[0]?.n ?? 0);

  const newAvailableRow = await db.$client.execute({
    sql: `
      SELECT COUNT(*) AS n
      FROM flashcards f
      INNER JOIN study_sessions ss ON ss.id = f.session_id
      WHERE ss.user_id = ? AND f.srs_state = 0
    `,
    args: [user.id],
  });
  const newAvailable = Number(newAvailableRow.rows[0]?.n ?? 0);
  const newWillShow = Math.min(newAvailable, newRemainingToday);

  const queueSize = Math.min(dueScheduled + newWillShow, reviewsRemainingToday);

  // ── Pull the actual rows ─────────────────────────────────────────
  // Two queries because the priority groups have different orderings.
  // We fetch up to `limit` due-scheduled rows first, then top up with
  // new cards if there's room and we're under the new-card cap.
  const scheduledRes = await db.$client.execute({
    sql: `
      SELECT
        f.id, f.front, f.back, f.page_number AS pageNumber,
        f.srs_state AS srsState, f.stability, f.difficulty,
        f.due_at AS dueAt, f.last_reviewed_at AS lastReviewedAt,
        f.lapses, f.reps, f.learning_steps AS learningSteps,
        f.session_id AS sessionId
      FROM flashcards f
      INNER JOIN study_sessions ss ON ss.id = f.session_id
      WHERE ss.user_id = ?
        AND (
          (f.srs_state IN (1, 3) AND f.due_at IS NOT NULL AND f.due_at <= ?)
          OR
          (f.srs_state = 2 AND f.due_at IS NOT NULL AND f.due_at <= ?)
        )
      ORDER BY
        CASE f.srs_state WHEN 1 THEN 0 WHEN 3 THEN 0 ELSE 1 END,
        f.due_at ASC
      LIMIT ?
    `,
    args: [user.id, lookaheadSec, nowSec, limit],
  });

  const scheduledRows = scheduledRes.rows;
  const remainingSlots = Math.max(0, limit - scheduledRows.length);
  const newToFetch = Math.min(remainingSlots, newRemainingToday);

  let newRows: typeof scheduledRows = [];
  if (newToFetch > 0) {
    const newRes = await db.$client.execute({
      sql: `
        SELECT
          f.id, f.front, f.back, f.page_number AS pageNumber,
          f.srs_state AS srsState, f.stability, f.difficulty,
          f.due_at AS dueAt, f.last_reviewed_at AS lastReviewedAt,
          f.lapses, f.reps, f.learning_steps AS learningSteps,
          f.session_id AS sessionId
        FROM flashcards f
        INNER JOIN study_sessions ss ON ss.id = f.session_id
        WHERE ss.user_id = ? AND f.srs_state = 0
        ORDER BY f.created_at ASC
        LIMIT ?
      `,
      args: [user.id, newToFetch],
    });
    newRows = newRes.rows;
  }

  // Apply the daily review cap to the combined output.
  const combined = [...scheduledRows, ...newRows].slice(0, reviewsRemainingToday);

  // Resolve deck titles. Sessions don't have a documents foreign key
  // directly; we look it up via session_content. Falls back to "Card"
  // when a session has no associated document (rare — review-mode
  // synthetic sessions).
  const sessionIds = Array.from(new Set(combined.map((r) => String(r.sessionId))));
  const deckTitleBySession = new Map<string, string>();
  if (sessionIds.length > 0) {
    const placeholders = sessionIds.map(() => "?").join(",");
    const deckRes = await db.$client.execute({
      sql: `
        SELECT sc.session_id AS sessionId, COALESCE(d.title, tc.title) AS deckTitle
        FROM session_content sc
        LEFT JOIN documents d ON d.id = sc.document_id
        LEFT JOIN textbook_catalog tc ON tc.id = d.textbook_catalog_id
        WHERE sc.session_id IN (${placeholders})
      `,
      args: sessionIds,
    });
    for (const row of deckRes.rows) {
      const sid = String(row.sessionId);
      if (!deckTitleBySession.has(sid)) {
        deckTitleBySession.set(sid, String(row.deckTitle ?? "Untitled deck"));
      }
    }
  }

  const cards = combined.map((row) => {
    const sessionId = String(row.sessionId);
    return {
      id: String(row.id),
      front: String(row.front),
      back: String(row.back),
      pageNumber: row.pageNumber == null ? null : Number(row.pageNumber),
      srsState: Number(row.srsState),
      stability: Number(row.stability),
      difficulty: Number(row.difficulty),
      dueAt: row.dueAt == null ? null : Number(row.dueAt) * 1000, // ms epoch
      lastReviewedAt:
        row.lastReviewedAt == null ? null : Number(row.lastReviewedAt) * 1000,
      lapses: Number(row.lapses),
      reps: Number(row.reps),
      learningSteps: Number(row.learningSteps),
      deckTitle: deckTitleBySession.get(sessionId) ?? "Untitled deck",
    };
  });

  return NextResponse.json({
    cards,
    queueSize,
    newRemainingToday,
    reviewsRemainingToday,
    capReached: false,
  });
}
