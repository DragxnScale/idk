/**
 * Spaced repetition scheduler — FSRS-4.5 wrapper.
 *
 * The rest of the app talks to spaced repetition through THIS module
 * only. `ts-fsrs` is intentionally not imported anywhere else so the
 * algorithm is pluggable later (custom-tuned weights per user, swap
 * to a future FSRS-6, etc.) without rippling through routes and UI.
 *
 * Two contracts the rest of the app sees:
 *
 *   1. `FlashcardSrsState` — the seven SRS columns we persist on each
 *      flashcard row. Plain numbers + a Date, not the bag of optional
 *      fields ts-fsrs exposes.
 *   2. `Grade` — `Again | Hard | Good | Easy` as ints 1..4. Matches
 *      Anki's UI ordering and ts-fsrs's Rating enum (intentionally —
 *      lets us pass numbers straight through without remapping).
 *
 * The "New + Good" first review intentionally produces a sub-day
 * interval (~10 minutes, Learning state). The card has to be graded
 * Good a second time before it graduates to Review state with day+
 * intervals. That's the standard Anki / FSRS UX — the first Good
 * means "I think I got this", and a couple of minutes later the
 * scheduler asks "do you still got it?" before committing to a real
 * spaced interval. This is what makes "review again later in the
 * same session" feel natural.
 */
import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  State,
  type Card as FsrsCard,
} from "ts-fsrs";

// ── Public types ─────────────────────────────────────────────────────

/** UI-facing grade values. Match `ts-fsrs.Rating` integers exactly. */
export const Grade = {
  Again: 1,
  Hard: 2,
  Good: 3,
  Easy: 4,
} as const;

export type GradeValue = (typeof Grade)[keyof typeof Grade];

/** State integers — match `ts-fsrs.State` exactly. */
export const SrsState = {
  New: 0,
  Learning: 1,
  Review: 2,
  Relearning: 3,
} as const;

export type SrsStateValue = (typeof SrsState)[keyof typeof SrsState];

/**
 * The seven columns we persist per flashcard. Mirrors the schema in
 * `lib/db/schema.ts`. Missing fields (`null` `dueAt`/`lastReviewedAt`
 * for truly-new cards) are filled in by `toFsrsCard()`.
 */
export interface FlashcardSrsState {
  srsState: number;
  stability: number;
  difficulty: number;
  dueAt: Date | null;
  lastReviewedAt: Date | null;
  lapses: number;
  reps: number;
  /**
   * Sub-day step counter while in Learning / Relearning state. MUST
   * round-trip through the DB — without it, a card stuck in Learning
   * state never graduates to Review because the scheduler keeps
   * thinking "this is the first learning step."
   */
  learningSteps: number;
}

/** Output of `scheduleNext()`. Same seven columns ready to UPDATE back. */
export interface ScheduleResult {
  state: FlashcardSrsState;
  /**
   * Days until the card is due next, computed from `now` to the new
   * `dueAt`. Sub-day relearning intervals (e.g. 10 minutes) come back
   * as fractional days like `0.007`. The UI rounds these for display.
   */
  intervalDays: number;
}

// ── Scheduler instance ───────────────────────────────────────────────

/**
 * Module-level scheduler. `enable_short_term: true` keeps the
 * 1-min/10-min relearning steps that make Again retries feel
 * immediate. `enable_fuzz: true` adds ±5% jitter to intervals so
 * a thousand cards reviewed on the same day don't all come due
 * on the exact same future day — spreads the future load out.
 */
const scheduler = fsrs(
  generatorParameters({
    enable_fuzz: true,
    enable_short_term: true,
    // 100-year cap. We don't want a card to go to "due in 200 years"
    // and silently disappear from the queue.
    maximum_interval: 36500,
  })
);

// ── Conversion to/from ts-fsrs internal Card ────────────────────────

function toFsrsCard(state: FlashcardSrsState, now: Date): FsrsCard {
  // A truly-new card gets the empty defaults from ts-fsrs (state=New,
  // stability=0, difficulty=0, due=now). For everything else we hand
  // back the persisted state as-is.
  if (state.srsState === SrsState.New && state.reps === 0) {
    return createEmptyCard(now);
  }
  return {
    due: state.dueAt ?? now,
    stability: state.stability,
    difficulty: state.difficulty,
    // `elapsed_days` and `scheduled_days` are only used internally on
    // the next() call to compute new intervals; ts-fsrs recomputes
    // them from `due` and `last_review` when needed, so passing 0
    // here is safe.
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: state.learningSteps,
    reps: state.reps,
    lapses: state.lapses,
    state: state.srsState as State,
    last_review: state.lastReviewedAt ?? undefined,
  };
}

function fromFsrsCard(card: FsrsCard, now: Date): ScheduleResult {
  const dueAt = new Date(card.due);
  const intervalMs = dueAt.getTime() - now.getTime();
  return {
    state: {
      srsState: card.state,
      stability: card.stability,
      difficulty: card.difficulty,
      dueAt,
      lastReviewedAt: card.last_review ? new Date(card.last_review) : now,
      lapses: card.lapses,
      reps: card.reps,
      learningSteps: card.learning_steps,
    },
    intervalDays: intervalMs / (1000 * 60 * 60 * 24),
  };
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Compute the next-review schedule for a card given its current SRS
 * state and the user's grade. Pure function — does not write to the
 * database.
 */
export function scheduleNext(
  state: FlashcardSrsState,
  grade: GradeValue,
  now: Date = new Date()
): ScheduleResult {
  const fsrsCard = toFsrsCard(state, now);
  // `Grade` (Anki ratings 1..4) is a non-exported subtype of `Rating`
  // in ts-fsrs (`Exclude<Rating, Rating.Manual>`). Passing our own
  // numeric value through requires the double cast — Rating itself
  // is too wide because it includes `Manual = 0`, but at runtime
  // ts-fsrs validates this and our caller has already constrained
  // `grade` to 1..4 via the GradeValue type.
  const out = scheduler.next(fsrsCard, now, grade as unknown as Parameters<typeof scheduler.next>[2]);
  return fromFsrsCard(out.card, now);
}

/**
 * Preview the four grade outcomes without committing any of them.
 * Used by the `/review` UI to label each grade button with the
 * resulting interval ("4d", "10d", etc.) BEFORE the user clicks. The
 * preview must use the same scheduler instance so what the user sees
 * matches what the server will actually persist.
 */
export function previewAllGrades(
  state: FlashcardSrsState,
  now: Date = new Date()
): Record<GradeValue, ScheduleResult> {
  const out = {} as Record<GradeValue, ScheduleResult>;
  for (const g of [Grade.Again, Grade.Hard, Grade.Good, Grade.Easy]) {
    out[g as GradeValue] = scheduleNext(state, g, now);
  }
  return out;
}

/**
 * Initialize a brand-new card. Used when reading a card row that has
 * never been graded — fills in the FSRS defaults so the UI / scheduler
 * have a consistent starting point. Pure; doesn't touch the DB.
 */
export function emptyState(): FlashcardSrsState {
  const c = createEmptyCard();
  return {
    srsState: SrsState.New,
    stability: c.stability,
    difficulty: c.difficulty,
    dueAt: null,
    lastReviewedAt: null,
    lapses: 0,
    reps: 0,
    learningSteps: 0,
  };
}

/**
 * Display helper: turn an interval (days, possibly fractional) into
 * a compact label like "1m" / "10m" / "3d" / "2mo" / "1y". Used both
 * on the grade-button previews and on the end-of-queue summary.
 */
export function formatInterval(days: number): string {
  if (!Number.isFinite(days) || days < 0) return "?";
  const minutes = days * 24 * 60;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const hours = days * 24;
  if (hours < 24) return `${Math.round(hours)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

/**
 * "Mature" cards are review-state cards whose memory is expected to
 * hold for at least 21 days — Anki's traditional cutoff for the
 * mature/young distinction. Surfaced as `mastery%` in the dashboard
 * stats and on per-deck progress.
 */
export function isMature(state: FlashcardSrsState): boolean {
  return state.srsState === SrsState.Review && state.stability >= 21;
}
