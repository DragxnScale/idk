/**
 * Lists the user's flashcard decks for the `/review` home screen.
 *
 *   GET /api/review/decks
 *   →
 *   {
 *     decks: [
 *       { deckKey, deckTitle, cardCount, dueCount, newCount, oldestCardAt },
 *       ...
 *     ],
 *     totalCards, totalDue, totalNew, oldestCardAt
 *   }
 *
 * A "deck" is whichever textbook / PDF a card was generated from. We
 * resolve it by joining the flashcard's session through `session_content`
 * and then preferring the textbook catalog row (shared books with a
 * stable identity across users) over the per-user `documents` row when
 * the catalog link exists. Cards that came from a session with no
 * attached document — exotic but possible if a session was deleted —
 * fall under a synthetic "Untitled deck" bucket so they don't disappear
 * from the picker.
 *
 * `oldestCardAt` is exposed so the home-screen "Maximum age" filter can
 * label its bounds with the user's actual data range — e.g. "All time
 * (since Apr 14)" instead of an open-ended slider.
 */
import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { resolveDeckTitle } from "@/lib/review-deck-title";

export const runtime = "nodejs";

const RELEARNING_LOOKAHEAD_MS = 10 * 60 * 1000;

export async function GET() {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const lookaheadSec = Math.floor((now + RELEARNING_LOOKAHEAD_MS) / 1000);
  const nowSec = Math.floor(now / 1000);

  // One query that resolves each card's deck + counts everything we
  // need for the picker. `deckKey` is `tc:<id>` for catalog books and
  // `d:<id>` for user-uploaded documents — using a single text key
  // lets the home screen treat both kinds uniformly. Sessions with
  // no `session_content` row collapse to `untitled` so they still
  // surface in the picker.
  // `dbTitle` is the coalesced catalog/document title — may be NULL
  // (e.g. an `untitled` row, or a document whose own title was never
  // filled in). `fallbackDocumentJson` is a representative session's
  // `document_json` we use to recover a sensible title in app code via
  // `resolveDeckTitle()`. MIN over TEXT is just a deterministic picker
  // — when multiple sessions group into one deck, any of them is fine
  // because they all describe the same reading.
  const sql = `
    SELECT
      COALESCE(
        CASE WHEN tc.id IS NOT NULL THEN 'tc:' || tc.id END,
        CASE WHEN fd.id IS NOT NULL THEN 'd:' || fd.id END,
        CASE WHEN d.id IS NOT NULL THEN 'd:' || d.id END,
        'untitled'
      ) AS deckKey,
      COALESCE(tc.title, fd.title, d.title) AS dbTitle,
      MIN(ss.document_json) AS fallbackDocumentJson,
      COUNT(DISTINCT f.id) AS cardCount,
      SUM(CASE
        WHEN (f.srs_state IN (1,3) AND f.due_at IS NOT NULL AND f.due_at <= ?)
          OR (f.srs_state = 2 AND f.due_at IS NOT NULL AND f.due_at <= ?)
        THEN 1 ELSE 0 END) AS dueCount,
      SUM(CASE WHEN f.srs_state = 0 THEN 1 ELSE 0 END) AS newCount,
      MIN(f.created_at) AS oldestCardAt
    FROM flashcards f
    INNER JOIN study_sessions ss ON ss.id = f.session_id
    LEFT JOIN session_content sc ON sc.session_id = ss.id
    LEFT JOIN documents d ON d.id = sc.document_id
    LEFT JOIN documents fd ON fd.id = f.document_id
    LEFT JOIN textbook_catalog tc ON tc.id = COALESCE(d.textbook_catalog_id, fd.textbook_catalog_id)
    WHERE ss.user_id = ? OR fd.user_id = ?
    GROUP BY deckKey, dbTitle
    ORDER BY cardCount DESC
  `;
  const res = await db.$client.execute({
    sql,
    args: [lookaheadSec, nowSec, user.id, user.id],
  });

  const decks = res.rows.map((r) => ({
    deckKey: String(r.deckKey),
    deckTitle: resolveDeckTitle(
      r.dbTitle == null ? null : String(r.dbTitle),
      r.fallbackDocumentJson == null ? null : String(r.fallbackDocumentJson),
    ),
    cardCount: Number(r.cardCount ?? 0),
    dueCount: Number(r.dueCount ?? 0),
    newCount: Number(r.newCount ?? 0),
    oldestCardAt: r.oldestCardAt == null ? null : Number(r.oldestCardAt) * 1000,
  }));

  const totalCards = decks.reduce((sum, d) => sum + d.cardCount, 0);
  const totalDue = decks.reduce((sum, d) => sum + d.dueCount, 0);
  const totalNew = decks.reduce((sum, d) => sum + d.newCount, 0);
  const oldestCardAt = decks.reduce<number | null>((min, d) => {
    if (d.oldestCardAt == null) return min;
    if (min == null) return d.oldestCardAt;
    return Math.min(min, d.oldestCardAt);
  }, null);

  return NextResponse.json({
    decks,
    totalCards,
    totalDue,
    totalNew,
    oldestCardAt,
  });
}
