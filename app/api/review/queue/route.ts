/**
 * Spaced-repetition review queue.
 *
 *   GET /api/review/queue?limit=50&mode=due&decks=tc:abc,d:xyz&maxAgeDays=30
 *   →
 *   {
 *     cards: [...],
 *     queueSize: 47,
 *     newRemainingToday: 12,
 *     reviewsRemainingToday: 188,
 *     capReached: false,
 *     mode: "due",
 *   }
 *
 * Two operating modes share this endpoint:
 *
 *   - `mode=due` (default, used by the dashboard "Due today" auto-fetch
 *     and the home-screen "What's due now" preset): includes
 *     Learning / Relearning cards in the next 10-min relearning
 *     window plus Review cards due now, then tops up with new cards
 *     under the per-user `srs_new_per_day` cap. Honors
 *     `srs_reviews_per_day` so a user returning from a long break
 *     gets a manageable pile.
 *
 *   - `mode=all | new | review | leeches`: explicit user-driven
 *     exploration from the home screen. Daily caps DON'T apply —
 *     when the user typed "no limit" into the home screen they meant
 *     it. Server still enforces a 1000-row hard ceiling for safety
 *     (no human reviews 1000 cards in a sitting; if you actually do,
 *     refresh the queue).
 *
 * Filters that work in every mode:
 *
 *   - `decks=key1,key2,...` — deck keys from `/api/review/decks`. A
 *     deck key is `tc:<textbookCatalogId>`, `d:<documentId>`, or the
 *     literal string `untitled` for cards whose session has no
 *     attached document. Empty / omitted = all decks.
 *   - `maxAgeDays=N` — only cards created within the last N days.
 *     `0` / omitted = no age filter.
 *
 * Ownership is enforced everywhere via the `flashcards → study_sessions
 * → users.id` join.
 */
import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { resolveDeckTitle } from "@/lib/review-deck-title";

export const runtime = "nodejs";

const DEFAULT_NEW_PER_DAY = 20;
const DEFAULT_REVIEWS_PER_DAY = 200;
const RELEARNING_LOOKAHEAD_MS = 10 * 60 * 1000;
// Hard ceiling regardless of mode — protects the page from accidentally
// fetching tens of thousands of rows when "no limit" gets misinterpreted.
const HARD_LIMIT_CEILING = 1000;
// Threshold for the "leeches" filter — Anki uses 8 by default but we're
// far less mature in the schedule space; 3 lapses already signals a
// card the user keeps stumbling on.
const LEECH_LAPSE_THRESHOLD = 3;

const VALID_MODES = new Set(["due", "all", "new", "review", "leeches"]);

interface DeckFilter {
  /** When true, no deck filtering — every owned card is in scope. */
  all: boolean;
  textbookCatalogIds: string[];
  documentIds: string[];
  includeUntitled: boolean;
}

type Arg = string | number;

function parseDeckParam(raw: string | null): DeckFilter {
  if (!raw) return { all: true, textbookCatalogIds: [], documentIds: [], includeUntitled: false };
  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return { all: true, textbookCatalogIds: [], documentIds: [], includeUntitled: false };
  }
  const textbookCatalogIds: string[] = [];
  const documentIds: string[] = [];
  let includeUntitled = false;
  for (const tok of tokens) {
    if (tok.startsWith("tc:")) textbookCatalogIds.push(tok.slice(3));
    else if (tok.startsWith("d:")) documentIds.push(tok.slice(2));
    else if (tok === "untitled") includeUntitled = true;
  }
  return { all: false, textbookCatalogIds, documentIds, includeUntitled };
}

/** Build the WHERE-clause fragment + args for the deck filter. Returns
 *  empty string when no filter is active. */
function deckFilterSql(filter: DeckFilter): { sql: string; args: Arg[] } {
  if (filter.all) return { sql: "", args: [] };
  const clauses: string[] = [];
  const args: Arg[] = [];
  if (filter.textbookCatalogIds.length > 0) {
    const placeholders = filter.textbookCatalogIds.map(() => "?").join(",");
    clauses.push(`tc.id IN (${placeholders})`);
    args.push(...filter.textbookCatalogIds);
  }
  if (filter.documentIds.length > 0) {
    const placeholders = filter.documentIds.map(() => "?").join(",");
    clauses.push(`(d.id IN (${placeholders}) AND d.textbook_catalog_id IS NULL)`);
    args.push(...filter.documentIds);
  }
  if (filter.includeUntitled) {
    clauses.push(`(d.id IS NULL AND tc.id IS NULL)`);
  }
  if (clauses.length === 0) {
    return { sql: "", args: [] };
  }
  return { sql: ` AND (${clauses.join(" OR ")})`, args };
}

export async function GET(request: Request) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const rawMode = (url.searchParams.get("mode") ?? "due").toLowerCase();
  const mode = VALID_MODES.has(rawMode) ? rawMode : "due";

  const rawLimit = url.searchParams.get("limit");
  // limit semantics:
  //   - omitted: 50 in due mode, HARD_LIMIT_CEILING in explicit modes
  //   - "0": no limit (interpreted as HARD_LIMIT_CEILING)
  //   - positive number: clamp to [1, HARD_LIMIT_CEILING]
  let limit: number;
  if (rawLimit == null) {
    limit = mode === "due" ? 50 : HARD_LIMIT_CEILING;
  } else {
    const n = Number(rawLimit);
    if (!Number.isFinite(n) || n <= 0) {
      limit = HARD_LIMIT_CEILING;
    } else {
      limit = Math.min(Math.max(Math.floor(n), 1), HARD_LIMIT_CEILING);
    }
  }

  const decks = parseDeckParam(url.searchParams.get("decks"));
  const deckFilter = deckFilterSql(decks);

  const maxAgeDaysRaw = url.searchParams.get("maxAgeDays");
  const maxAgeDays =
    maxAgeDaysRaw && Number.isFinite(Number(maxAgeDaysRaw)) && Number(maxAgeDaysRaw) > 0
      ? Math.floor(Number(maxAgeDaysRaw))
      : 0;
  const minCreatedSec =
    maxAgeDays > 0
      ? Math.floor((Date.now() - maxAgeDays * 86_400_000) / 1000)
      : 0;
  const ageFilterSql = minCreatedSec > 0 ? " AND f.created_at >= ?" : "";
  const ageFilterArgs: number[] = minCreatedSec > 0 ? [minCreatedSec] : [];

  const now = Date.now();
  const lookaheadSec = Math.floor((now + RELEARNING_LOOKAHEAD_MS) / 1000);
  const nowSec = Math.floor(now / 1000);

  // ── Per-user pacing caps (only applied in due mode) ──────────────
  const userRow = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, user.id),
    columns: { srsNewPerDay: true, srsReviewsPerDay: true },
  });
  const newCap = userRow?.srsNewPerDay ?? DEFAULT_NEW_PER_DAY;
  const reviewsCap = userRow?.srsReviewsPerDay ?? DEFAULT_REVIEWS_PER_DAY;

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartSec = Math.floor(todayStart.getTime() / 1000);

  // ── Daily cap accounting (always reported so the UI can show
  //    "12/20 new today" even in explicit modes) ───────────────────
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

  if (mode === "due" && reviewsRemainingToday === 0) {
    return NextResponse.json({
      cards: [],
      queueSize: 0,
      newRemainingToday,
      reviewsRemainingToday: 0,
      capReached: true,
      mode,
    });
  }

  // The deck-filter join is identical for every SELECT in this route,
  // so build once and reuse. The COUNT path doesn't need session_content
  // unless a deck filter is active — but adding it unconditionally
  // keeps the SQL simple and the join is cheap thanks to PK indexes.
  const baseFromJoin = `
    FROM flashcards f
    INNER JOIN study_sessions ss ON ss.id = f.session_id
    LEFT JOIN session_content sc ON sc.session_id = ss.id
    LEFT JOIN documents d ON d.id = sc.document_id
    LEFT JOIN textbook_catalog tc ON tc.id = d.textbook_catalog_id
  `;
  const baseWhere = `ss.user_id = ?${deckFilter.sql}${ageFilterSql}`;
  const baseArgs = (extra: Arg[]): Arg[] => [
    user.id,
    ...deckFilter.args,
    ...ageFilterArgs,
    ...extra,
  ];

  // ── Mode-specific selection ──────────────────────────────────────
  // Each mode produces:
  //   - `selectClause`: the WHERE predicate that picks rows
  //   - `orderBy`: how to order the rows
  //   - `extraArgs`: any args needed by the predicate (e.g. lookahead)
  //   - `applyDailyCaps`: whether `srs_reviews_per_day` truncates output
  //   - `topUpWithNew`: whether the result should be topped up with
  //     new cards (only relevant for `due` mode; the explicit modes
  //     either fetch news directly or don't include them at all)
  let selectClause: string;
  let orderBy: string;
  let extraArgs: Arg[];
  let applyDailyCaps: boolean;
  let topUpWithNew: boolean;
  switch (mode) {
    case "all":
      selectClause = "1 = 1";
      orderBy = `
        CASE
          WHEN f.due_at IS NULL THEN 1
          ELSE 0
        END,
        f.due_at ASC,
        f.created_at ASC
      `;
      extraArgs = [];
      applyDailyCaps = false;
      topUpWithNew = false;
      break;
    case "new":
      selectClause = "f.srs_state = 0";
      orderBy = "f.created_at ASC";
      extraArgs = [];
      applyDailyCaps = false;
      topUpWithNew = false;
      break;
    case "review":
      selectClause = "f.srs_state = 2";
      orderBy = "f.due_at ASC";
      extraArgs = [];
      applyDailyCaps = false;
      topUpWithNew = false;
      break;
    case "leeches":
      selectClause = `f.lapses >= ${LEECH_LAPSE_THRESHOLD}`;
      orderBy = "f.lapses DESC, f.due_at ASC";
      extraArgs = [];
      applyDailyCaps = false;
      topUpWithNew = false;
      break;
    default: // "due"
      selectClause = `(
        (f.srs_state IN (1, 3) AND f.due_at IS NOT NULL AND f.due_at <= ?)
        OR
        (f.srs_state = 2 AND f.due_at IS NOT NULL AND f.due_at <= ?)
      )`;
      orderBy = `
        CASE f.srs_state WHEN 1 THEN 0 WHEN 3 THEN 0 ELSE 1 END,
        f.due_at ASC
      `;
      extraArgs = [lookaheadSec, nowSec];
      applyDailyCaps = true;
      topUpWithNew = true;
      break;
  }

  // Total count for this mode (informational; the UI shows "47 cards"
  // before the daily cap kicks in).
  const totalSql = `
    SELECT COUNT(DISTINCT f.id) AS n
    ${baseFromJoin}
    WHERE ${baseWhere} AND ${selectClause}
  `;
  const totalRow = await db.$client.execute({
    sql: totalSql,
    args: baseArgs(extraArgs),
  });
  const totalForMode = Number(totalRow.rows[0]?.n ?? 0);

  // ── Pull rows ────────────────────────────────────────────────────
  const fetchSql = `
    SELECT DISTINCT
      f.id, f.front, f.back, f.page_number AS pageNumber,
      f.srs_state AS srsState, f.stability, f.difficulty,
      f.due_at AS dueAt, f.last_reviewed_at AS lastReviewedAt,
      f.lapses, f.reps, f.learning_steps AS learningSteps,
      f.session_id AS sessionId, f.created_at AS createdAt
    ${baseFromJoin}
    WHERE ${baseWhere} AND ${selectClause}
    ORDER BY ${orderBy}
    LIMIT ?
  `;
  const fetchRes = await db.$client.execute({
    sql: fetchSql,
    args: baseArgs([...extraArgs, limit]),
  });
  let rows = fetchRes.rows;

  // In `due` mode top up with new cards under the per-day cap.
  if (topUpWithNew) {
    const remainingSlots = Math.max(0, limit - rows.length);
    const newToFetch = Math.min(remainingSlots, newRemainingToday);
    if (newToFetch > 0) {
      const newSql = `
        SELECT DISTINCT
          f.id, f.front, f.back, f.page_number AS pageNumber,
          f.srs_state AS srsState, f.stability, f.difficulty,
          f.due_at AS dueAt, f.last_reviewed_at AS lastReviewedAt,
          f.lapses, f.reps, f.learning_steps AS learningSteps,
          f.session_id AS sessionId, f.created_at AS createdAt
        ${baseFromJoin}
        WHERE ${baseWhere} AND f.srs_state = 0
        ORDER BY f.created_at ASC
        LIMIT ?
      `;
      const newRes = await db.$client.execute({
        sql: newSql,
        args: baseArgs([newToFetch]),
      });
      rows = [...rows, ...newRes.rows];
    }
  }

  if (applyDailyCaps) {
    rows = rows.slice(0, reviewsRemainingToday);
  }

  // ── Resolve deck titles for the response ─────────────────────────
  // Pulls from study_sessions directly (not session_content) so that
  // sessions without a session_content row still surface a title via
  // their `document_json` fallback — without this, those decks ALWAYS
  // render as "Untitled deck" even when the session itself carries
  // the chapter-range title in its embedded JSON.
  const sessionIds = Array.from(new Set(rows.map((r) => String(r.sessionId))));
  const deckTitleBySession = new Map<string, string>();
  if (sessionIds.length > 0) {
    const placeholders = sessionIds.map(() => "?").join(",");
    const deckRes = await db.$client.execute({
      sql: `
        SELECT ss.id AS sessionId,
               COALESCE(tc.title, d.title) AS dbTitle,
               ss.document_json AS documentJson
        FROM study_sessions ss
        LEFT JOIN session_content sc ON sc.session_id = ss.id
        LEFT JOIN documents d ON d.id = sc.document_id
        LEFT JOIN textbook_catalog tc ON tc.id = d.textbook_catalog_id
        WHERE ss.id IN (${placeholders})
      `,
      args: sessionIds,
    });
    for (const row of deckRes.rows) {
      const sid = String(row.sessionId);
      if (!deckTitleBySession.has(sid)) {
        deckTitleBySession.set(
          sid,
          resolveDeckTitle(
            row.dbTitle == null ? null : String(row.dbTitle),
            row.documentJson == null ? null : String(row.documentJson),
          ),
        );
      }
    }
  }

  const cards = rows.map((row) => {
    const sessionId = String(row.sessionId);
    return {
      id: String(row.id),
      front: String(row.front),
      back: String(row.back),
      pageNumber: row.pageNumber == null ? null : Number(row.pageNumber),
      srsState: Number(row.srsState),
      stability: Number(row.stability),
      difficulty: Number(row.difficulty),
      dueAt: row.dueAt == null ? null : Number(row.dueAt) * 1000,
      lastReviewedAt:
        row.lastReviewedAt == null ? null : Number(row.lastReviewedAt) * 1000,
      lapses: Number(row.lapses),
      reps: Number(row.reps),
      learningSteps: Number(row.learningSteps),
      deckTitle: deckTitleBySession.get(sessionId) ?? "Untitled deck",
    };
  });

  // `queueSize` semantics differ slightly per mode:
  //   - due mode: total due (incl new cap) so the progress bar is
  //     accurate even when the local queue limit is small
  //   - explicit modes: count from this mode's filter, capped to limit
  let queueSize: number;
  if (mode === "due") {
    queueSize = Math.min(
      totalForMode + Math.min(newRemainingToday, limit - Math.min(totalForMode, limit)),
      reviewsRemainingToday > 0 ? reviewsRemainingToday : Number.MAX_SAFE_INTEGER
    );
  } else {
    queueSize = Math.min(totalForMode, limit);
  }

  return NextResponse.json({
    cards,
    queueSize,
    newRemainingToday,
    reviewsRemainingToday,
    capReached: false,
    mode,
  });
}
