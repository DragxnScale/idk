/**
 * Dashboard SRS stats — powers the "Due today" card and any future
 * mastery indicators.
 *
 *   GET /api/review/stats
 *   →
 *   {
 *     dueNow: 47,        // due right now (or in the next 10min relearning window)
 *     dueToday: 53,      // due before tomorrow midnight UTC
 *     newToday: 12,      // new cards already introduced today (capped by user setting)
 *     newAvailable: 80,  // total un-introduced new cards in the user's collection
 *     newRemainingToday: 8,   // new-cap left for today
 *     matureCount: 280,  // cards with srs_state=Review AND stability >= 21d
 *     learningCount: 5,  // cards in Learning or Relearning state
 *     totalCards: 412,
 *   }
 *
 * Single round-trip — one batched SELECT covers all the counts.
 */
import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const DEFAULT_NEW_PER_DAY = 20;
const RELEARNING_LOOKAHEAD_MS = 10 * 60 * 1000;

export async function GET() {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);

  const nowSec = Math.floor(now.getTime() / 1000);
  const lookaheadSec = Math.floor((now.getTime() + RELEARNING_LOOKAHEAD_MS) / 1000);
  const todayStartSec = Math.floor(todayStart.getTime() / 1000);
  const tomorrowStartSec = Math.floor(tomorrowStart.getTime() / 1000);

  // Per-user new-card cap.
  const userRow = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, user.id),
    columns: { srsNewPerDay: true },
  });
  const newCap = userRow?.srsNewPerDay ?? DEFAULT_NEW_PER_DAY;

  // Single aggregation — sum a bunch of CASE expressions in one pass
  // over the user's flashcards. SQLite chews through this fine even
  // at 10k cards; revisit if anyone ends up with 100k+.
  const sql = `
    SELECT
      SUM(CASE
        WHEN (f.srs_state IN (1,3) AND f.due_at IS NOT NULL AND f.due_at <= ?) -- relearning lookahead
          OR (f.srs_state = 2 AND f.due_at IS NOT NULL AND f.due_at <= ?)      -- review due now
        THEN 1 ELSE 0 END) AS dueNow,
      SUM(CASE
        WHEN f.due_at IS NOT NULL AND f.due_at < ? AND f.srs_state IN (1,2,3)
        THEN 1 ELSE 0 END) AS dueToday,
      SUM(CASE
        WHEN f.reps = 1 AND f.last_reviewed_at >= ?
        THEN 1 ELSE 0 END) AS newToday,
      SUM(CASE WHEN f.srs_state = 0 THEN 1 ELSE 0 END) AS newAvailable,
      SUM(CASE WHEN f.srs_state = 2 AND f.stability >= 21 THEN 1 ELSE 0 END) AS matureCount,
      SUM(CASE WHEN f.srs_state IN (1,3) THEN 1 ELSE 0 END) AS learningCount,
      COUNT(*) AS totalCards
    FROM flashcards f
    INNER JOIN study_sessions ss ON ss.id = f.session_id
    WHERE ss.user_id = ?
  `;
  const args = [
    lookaheadSec,
    nowSec,
    tomorrowStartSec,
    todayStartSec,
    user.id,
  ];

  const res = await db.$client.execute({ sql, args });
  const row = res.rows[0] ?? {};
  const num = (k: string) => Number(row[k] ?? 0);

  const newToday = num("newToday");
  const newRemainingToday = Math.max(0, newCap - newToday);

  return NextResponse.json({
    dueNow: num("dueNow"),
    dueToday: num("dueToday"),
    newToday,
    newAvailable: num("newAvailable"),
    newRemainingToday,
    matureCount: num("matureCount"),
    learningCount: num("learningCount"),
    totalCards: num("totalCards"),
  });
}
