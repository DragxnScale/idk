# Spaced Repetition for Flashcards

> Runbook for the SRS rollout. Captures the goal, the data-model
> change, the algorithm wrapper, the new API surface, and the
> verification SQL so the next person touching scheduling has a
> checked-in record. Mirrors the structure of
> [`docs/r2-update.md`](r2-update.md).

## Goal

Turn the existing flashcards from a session-bound stack into a
daily-compounding spaced-repetition system using **FSRS-4.5** (the
modern successor to SM-2 used by current Anki). The dashboard surfaces
a "Due today" card so users come back daily; cards they got right come
back later, cards they got wrong come back sooner.

```mermaid
flowchart LR
  subgraph Today
    A[Open dashboard] -->|"47 cards due"| B[/review page]
    B --> C{Front of card}
    C -->|Space| D[Back of card]
    D -->|1 Again| E1[Re-queue in same session]
    D -->|2 Hard| E2[Smaller interval growth]
    D -->|3 Good| E3[Standard interval growth]
    D -->|4 Easy| E4[Larger interval growth]
    E1 & E2 & E3 & E4 --> C
    C -->|Queue empty| F[Done — see you tomorrow]
  end
```

## Strategy in one paragraph

Use FSRS-4.5 via the [`ts-fsrs`](https://www.npmjs.com/package/ts-fsrs)
package. Add eight columns to the existing `flashcards` table — no new
tables. Existing cards become "new" on first `/review` visit and enter
the queue automatically. The fullscreen `/review` page pulls due cards
across **every** textbook the user has studied (not session-bound) and
grades them with Again/Hard/Good/Easy. The dashboard gets a "Due today"
card next to the streak to drive daily engagement. AI generation, the
per-session Flashcards tab, and the existing `FlashcardView` component
all stay exactly as they are — only scheduling is new.

## Why FSRS over SM-2

- **Better retention prediction.** FSRS models stability and
  difficulty separately; SM-2 conflates them into a single ease factor.
- **Maintained.** `ts-fsrs` is actively maintained, has 50k+ weekly
  downloads, and ships TypeScript types out of the box.
- **Tunable.** FSRS parameters can be optimized per-user from grade
  history (deferred to v1.5; we ship with the published default `w`
  weights).
- **Same UX as Anki.** Users coming from Anki / RemNote recognize the
  four-grade system instantly.

## Data model

Eight new columns on `flashcards` and two new columns on `users`. Index
on `(session_id, due_at)` because the queue read joins through
`session_id` to enforce ownership and orders by `due_at`.

```sql
ALTER TABLE flashcards ADD COLUMN srs_state INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flashcards ADD COLUMN stability REAL NOT NULL DEFAULT 0;
ALTER TABLE flashcards ADD COLUMN difficulty REAL NOT NULL DEFAULT 0;
ALTER TABLE flashcards ADD COLUMN due_at INTEGER;
ALTER TABLE flashcards ADD COLUMN last_reviewed_at INTEGER;
ALTER TABLE flashcards ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flashcards ADD COLUMN reps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flashcards ADD COLUMN learning_steps INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS flashcards_due_at_idx ON flashcards (session_id, due_at);

ALTER TABLE users ADD COLUMN srs_new_per_day INTEGER DEFAULT 20;
ALTER TABLE users ADD COLUMN srs_reviews_per_day INTEGER DEFAULT 200;
```

`learning_steps` was the bug-trap column. Without it, a card stuck in
`Learning` state never graduates to `Review` because the scheduler
reads "no learning step has been completed yet" on every grade and
issues another sub-day interval. The smoke test at
`scripts/_test-srs.ts` covers this regression directly (sequential
Goods must produce monotonically growing intervals).

Apply the migration via the idempotent helper:

```bash
node scripts/apply-srs-schema.mjs
```

It reads `.env.local`, runs every ALTER in a `try/catch` that swallows
the `duplicate column name` error, and prints a summary at the end so
you can sanity-check `srs_state = 0` (new) row counts.

## Algorithm wrapper — `lib/srs.ts`

The rest of the app talks to spaced repetition through `lib/srs.ts`
only. `ts-fsrs` is intentionally not imported anywhere else so the
algorithm is pluggable later (custom-tuned weights per user, swap to
a future FSRS-6, etc.) without rippling through routes and UI.

Public surface:

- `Grade` / `GradeValue` — `Again | Hard | Good | Easy` as ints 1..4.
- `SrsState` / `SrsStateValue` — `New | Learning | Review | Relearning`
  as ints 0..3.
- `FlashcardSrsState` — the eight columns we persist.
- `scheduleNext(state, grade, now?) → ScheduleResult` — pure function
  returning the new state + interval days.
- `previewAllGrades(state, now?)` — used by the `/review` UI to label
  each grade button with its resulting interval (`4d`, `10d`, …)
  computed via the same scheduler instance so what the user sees
  matches what the server actually persists.
- `emptyState()` — fresh card defaults.
- `formatInterval(days)` — compact label (`1m`, `3d`, `2mo`, `1y`).
- `isMature(state)` — review-state cards with `stability ≥ 21` days,
  matching Anki's traditional young/mature cutoff.

The scheduler instance enables `enable_short_term: true` so a brand-new
card graded `Good` lands in `Learning` state with a ~10 minute interval
(not multi-day). The card has to be graded `Good` a second time before
it graduates to `Review` state. That's standard Anki / FSRS UX — the
first Good is "I think I got it"; ten minutes later the scheduler asks
"do you still got it?" before committing to a real spaced interval.

## API surface

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/review/queue` | Build the user's review queue. |
| POST | `/api/review/grade` | Persist a grade and the new schedule. |
| GET | `/api/review/stats` | Dashboard counts (`dueNow`, `newToday`, `matureCount`, …). |
| POST | `/api/review/session` | Synthetic `study_sessions` row for streak credit. |

Notable details:

- The queue includes Learning / Relearning cards due within the next
  10 minutes. That's how "review again later in the same session"
  works — when the user grades `Again`, the new `due_at` is `now +
  1 min`, and the next refill catches it.
- New-card cap: at most `srs_new_per_day` cards with `srs_state = 0`
  per user per UTC day. Tracked via
  `COUNT(*) WHERE reps = 1 AND last_reviewed_at >= today_start` —
  `reps` jumps from 0 to 1 on the very first grade so this is the
  canonical "introduced today" signal.
- Reviews cap: total daily review cap, default 200. Excess due cards
  get prioritized by `due_at` (most overdue first) so a user returning
  from a long break catches up gradually.
- Ownership check on grade: the route joins `flashcards` →
  `study_sessions` → `user_id` so a user can never grade someone
  else's card.

## Streak compatibility

A 5-minute review session counts toward the daily streak. Mechanism:

1. `ReviewSession.tsx` records `sessionStartRef = Date.now()` on mount
   and increments `reviewedCount` on every successful grade.
2. On unmount (route change or queue clear), it POSTs to
   `/api/review/session` with `{ startedAt, endedAt, cardsReviewed }`.
   Empty visits (`cardsReviewed === 0`) are skipped.
3. The route inserts one `study_sessions` row tagged
   `goal_type = "review"`. The existing streak query in
   `/api/study/stats` walks `study_sessions` day-by-day, so it picks
   this up automatically.

This is option A from the plan ("synthetic row, no fork of streak
math"). Option B (separate `review_sessions` table) was rejected
because it doubles the streak-calculation surface area for marginal
benefit.

For tab-close cases (no React unmount), `navigator.sendBeacon` is the
fallback so the streak still gets credited even when the user kills
the tab mid-session.

## Migration of existing cards

No script needed. The schema migration sets `srs_state = 0` for every
existing row (default), so existing cards are "new" cards. The first
time a user opens `/review`, their existing cards naturally enter the
queue, capped by their `srs_new_per_day` setting (default 20). No bytes
need rewriting, no AI re-generation.

## Verification

After deploy:

```sql
-- Sanity: every card has FSRS state initialized
SELECT count(*) FROM flashcards WHERE srs_state IS NULL;     -- expect 0
SELECT count(*) FROM flashcards WHERE difficulty IS NULL;    -- expect 0

-- Sanity: scheduled cards have a future due_at
SELECT count(*) FROM flashcards
WHERE srs_state > 0 AND due_at IS NULL;                      -- expect 0

-- The index is in place
SELECT name FROM sqlite_master
WHERE type='index' AND name='flashcards_due_at_idx';         -- expect 1 row
```

Manual smoke test:

1. Open `/review`, see existing cards as "new".
2. Grade one Good → button preview said `~10m`; card disappears from
   queue; `due_at` in DB is ~10 minutes out.
3. Grade one Again → card re-appears within ~1 min in the same
   session; after grading Good twice afterwards, scheduled normally.
4. Refresh dashboard — "Due today" count drops by the number reviewed.
5. Settings → Spaced repetition → set "New cards per day" to `0`,
   reload `/review` → only currently-scheduled cards show, no new
   cards introduced.
6. Run `npx tsx scripts/_test-srs.ts` — all assertions pass (sequential
   Goods produce 2d → 13d → 55d → 187d intervals or similar growing
   sequence).

## Risks and mitigations

- **Algorithm bugs corrupt schedules.** Mitigation: `lib/srs.ts` is the
  only file that imports `ts-fsrs`, so any future swap is local.
  Before each ts-fsrs upgrade, run `npx tsx scripts/_test-srs.ts` —
  the four FSRS scenarios from the plan are covered there.
- **Users return after months and face thousands of cards.**
  Mitigation: `srs_reviews_per_day` cap (default 200) puts a soft
  ceiling. Excess due cards get prioritized by `due_at` (most overdue
  first) until the user catches up.
- **Synthetic study_sessions inflates focused-minutes stats.** v1
  tags the row with `goal_type = "review"` so admin analytics can
  filter it out if needed. The dashboard "Today" counter currently
  doesn't filter — review minutes count as study minutes, which
  matches user intent ("I studied today").
- **Queue ordering surprises.** When the local queue empties but the
  server still has more cards, the page refetches once. Relearning
  cards graded Again come back at the END of the local queue (not the
  front) so the user works through everything else first; the next
  refetch catches them via the 10-minute lookahead window.

## Out of scope (v1)

Captured here so they're not lost — explicitly NOT shipping in this
round:

- Per-deck filter on `/review` (just review everything together).
- Per-user FSRS parameter optimization from grade history.
- Card editing during review (Esc out, edit in the session summary's
  Flashcards tab, return).
- Mobile push notifications ("47 cards due"). Pairs perfectly with
  SRS but is its own feature.
- Smart-review integration (AI regenerates cards on weak concepts).
- Public / shared decks.
- "Bury" and "suspend" card actions.
