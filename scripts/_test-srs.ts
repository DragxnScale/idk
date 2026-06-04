/**
 * Self-contained smoke test for `lib/srs.ts`.
 *
 *   npx tsx scripts/_test-srs.ts
 *
 * Exits non-zero if any assertion fails. Covers the four scenarios
 * called out in the SRS plan:
 *
 *   1. New + Good → Learning state with sub-day interval (the first
 *      Good is "I think I got it"; Anki's standard graduation needs
 *      a confirmation pass).
 *   2. New + Again → Learning with a 1-min interval so the card
 *      re-appears in the same review session.
 *   3. Mature Review card + Again → Relearning with `lapses`
 *      incremented.
 *   4. Sequential Goods produce growing intervals — exact values
 *      vary with FSRS parameters but each subsequent interval must
 *      be strictly bigger than the previous one once we're in the
 *      Review state.
 *
 * No vitest / no jest — this codebase has no test runner and adding
 * one for a single algorithm wrapper is over-the-top. Plain throws +
 * a console summary at the end.
 */
import {
  Grade,
  SrsState,
  emptyState,
  scheduleNext,
  previewAllGrades,
  formatInterval,
  isMature,
} from "../lib/srs";

let failures = 0;
function check(label: string, ok: boolean, details = "") {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${details ? ` — ${details}` : ""}`);
  }
}

function days(state: { dueAt: Date | null }, now: Date) {
  if (!state.dueAt) return 0;
  return (state.dueAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
}

const t0 = new Date("2026-01-01T12:00:00Z");

console.log("1. New + Good → Learning, sub-day interval");
{
  const r = scheduleNext(emptyState(), Grade.Good, t0);
  check("state is Learning", r.state.srsState === SrsState.Learning, `got ${r.state.srsState}`);
  check("interval < 1 day", r.intervalDays < 1, `got ${r.intervalDays.toFixed(3)}d`);
  check("reps incremented to 1", r.state.reps === 1);
  check("lapses still 0", r.state.lapses === 0);
}

console.log("2. New + Again → Learning, ~1 min interval");
{
  const r = scheduleNext(emptyState(), Grade.Again, t0);
  check("state is Learning", r.state.srsState === SrsState.Learning);
  const minutes = r.intervalDays * 24 * 60;
  check("interval is short (≤ 15 min)", minutes <= 15, `got ${minutes.toFixed(2)}min`);
}

console.log("3. New + Easy → Review, multi-day interval");
{
  const r = scheduleNext(emptyState(), Grade.Easy, t0);
  check("state is Review", r.state.srsState === SrsState.Review);
  check("interval ≥ 4d", r.intervalDays >= 4, `got ${r.intervalDays.toFixed(2)}d`);
}

console.log("4. Mature Review card + Again → Relearning, lapses++");
{
  const mature = {
    srsState: SrsState.Review,
    stability: 30,
    difficulty: 5,
    dueAt: t0,
    lastReviewedAt: new Date(t0.getTime() - 30 * 24 * 60 * 60 * 1000),
    lapses: 0,
    reps: 5,
    learningSteps: 0,
  };
  const r = scheduleNext(mature, Grade.Again, t0);
  check("state is Relearning", r.state.srsState === SrsState.Relearning, `got ${r.state.srsState}`);
  check("lapses incremented", r.state.lapses === 1, `got ${r.state.lapses}`);
}

console.log("5. Sequential Goods produce monotonically growing intervals");
{
  let state = emptyState();
  let now = new Date(t0);
  const intervals: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r = scheduleNext(state, Grade.Good, now);
    state = r.state;
    intervals.push(r.intervalDays);
    if (r.state.dueAt) now = r.state.dueAt;
  }
  // Once we're in Review state intervals must strictly grow. The first
  // Good produces a Learning step (~10 min). The second Good graduates
  // to Review and gives the first multi-day interval. After that every
  // interval must be strictly bigger than the previous one.
  const reviewIntervals = intervals.slice(1);
  for (let i = 1; i < reviewIntervals.length; i++) {
    check(
      `interval ${i + 1} > interval ${i} (${reviewIntervals[i].toFixed(1)}d > ${reviewIntervals[i - 1].toFixed(1)}d)`,
      reviewIntervals[i] > reviewIntervals[i - 1]
    );
  }
}

console.log("6. previewAllGrades returns a sensible ordering");
{
  const previews = previewAllGrades(emptyState(), t0);
  const a = previews[Grade.Again].intervalDays;
  const h = previews[Grade.Hard].intervalDays;
  const g = previews[Grade.Good].intervalDays;
  const e = previews[Grade.Easy].intervalDays;
  check(
    `Again < Hard ≤ Good < Easy (${a.toFixed(3)}, ${h.toFixed(3)}, ${g.toFixed(3)}, ${e.toFixed(3)})`,
    a < h && h <= g && g < e
  );
}

console.log("7. formatInterval label boundaries");
{
  check("0.0007d → 1m", formatInterval(0.0007) === "1m");
  check("0.5d → 12h", formatInterval(0.5) === "12h");
  check("4d → 4d", formatInterval(4) === "4d");
  check("60d → 2mo", formatInterval(60) === "2mo");
  check("400d → 1y", formatInterval(400) === "1y");
}

console.log("8. isMature");
{
  const m = { srsState: SrsState.Review, stability: 25, difficulty: 5, dueAt: t0, lastReviewedAt: t0, lapses: 0, reps: 3, learningSteps: 0 };
  const young = { ...m, stability: 5 };
  const learning = { ...m, srsState: SrsState.Learning, stability: 100 };
  check("review + 25d stability is mature", isMature(m));
  check("review + 5d stability is NOT mature", !isMature(young));
  check("learning state is NOT mature regardless of stability", !isMature(learning));
}

console.log("");
if (failures === 0) {
  console.log("All SRS smoke tests passed.");
  process.exit(0);
} else {
  console.log(`${failures} failure(s).`);
  process.exit(1);
}
