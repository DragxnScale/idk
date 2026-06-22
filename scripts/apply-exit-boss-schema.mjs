/**
 * Boss Beacons exit protection columns.
 *
 *   node scripts/apply-exit-boss-schema.mjs
 *
 * Idempotent — safe to re-run.
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
  "ALTER TABLE users ADD COLUMN exit_boss_beacons_enabled INTEGER DEFAULT 1",
  "ALTER TABLE study_sessions ADD COLUMN exit_method TEXT",
  "UPDATE users SET exit_boss_beacons_enabled = 1 WHERE exit_boss_beacons_enabled IS NULL",
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

console.log("Boss Beacons schema applied.");
