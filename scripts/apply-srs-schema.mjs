/**
 * Applies the SRS columns from the spaced-repetition plan directly to
 * the connected Turso database.
 *
 *   node scripts/apply-srs-schema.mjs
 *
 * Idempotent: each ALTER is wrapped in a try/catch that swallows the
 * "duplicate column name" error so re-running is safe. After this:
 *
 *   - `flashcards` gets srs_state, stability, difficulty, due_at,
 *     last_reviewed_at, lapses, reps.
 *   - An index `flashcards_due_at_idx` on (session_id, due_at) speeds
 *     up the queue join. Per-user filtering happens via session_id →
 *     study_sessions.user_id, which is already indexed by the FK.
 *   - `users` gets srs_new_per_day, srs_reviews_per_day.
 */
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] ||= m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

const c = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

const statements = [
  // ── flashcards ─────────────────────────────────────────────────────
  "ALTER TABLE flashcards ADD COLUMN srs_state INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE flashcards ADD COLUMN stability REAL NOT NULL DEFAULT 0",
  "ALTER TABLE flashcards ADD COLUMN difficulty REAL NOT NULL DEFAULT 0",
  "ALTER TABLE flashcards ADD COLUMN due_at INTEGER",
  "ALTER TABLE flashcards ADD COLUMN last_reviewed_at INTEGER",
  "ALTER TABLE flashcards ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE flashcards ADD COLUMN reps INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE flashcards ADD COLUMN learning_steps INTEGER NOT NULL DEFAULT 0",
  "CREATE INDEX IF NOT EXISTS flashcards_due_at_idx ON flashcards (session_id, due_at)",

  // ── users ──────────────────────────────────────────────────────────
  "ALTER TABLE users ADD COLUMN srs_new_per_day INTEGER DEFAULT 20",
  "ALTER TABLE users ADD COLUMN srs_reviews_per_day INTEGER DEFAULT 200",
];

for (const sql of statements) {
  try {
    await c.execute(sql);
    console.log(`ok   ${sql}`);
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (
      msg.includes("duplicate column name") ||
      msg.includes("already exists")
    ) {
      console.log(`skip ${sql}  (already applied)`);
    } else {
      console.error(`FAIL ${sql}`);
      console.error(`     ${msg}`);
      process.exit(1);
    }
  }
}

console.log("");

const cardCount = await c.execute("SELECT count(*) AS n FROM flashcards");
const newCardCount = await c.execute(
  "SELECT count(*) AS n FROM flashcards WHERE srs_state = 0",
);
const userCount = await c.execute("SELECT count(*) AS n FROM users");
console.log(
  `flashcards: total=${cardCount.rows[0].n}, srs_state=0 (new)=${newCardCount.rows[0].n}`,
);
console.log(`users: ${userCount.rows[0].n}`);
console.log("Schema applied.");
