/**
 * Adds input_text / output_text to ai_usage_logs for admin AI usage audit.
 *
 *   node scripts/apply-ai-usage-text-columns.mjs
 *
 * Idempotent: duplicate-column errors are skipped.
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
  "ALTER TABLE ai_usage_logs ADD COLUMN input_text TEXT",
  "ALTER TABLE ai_usage_logs ADD COLUMN output_text TEXT",
];

for (const sql of statements) {
  try {
    await c.execute(sql);
    console.log(`ok   ${sql}`);
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (msg.includes("duplicate column name") || msg.includes("already exists")) {
      console.log(`skip ${sql}  (already applied)`);
    } else {
      console.error(`FAIL ${sql}`);
      console.error(`     ${msg}`);
      process.exit(1);
    }
  }
}

const info = await c.execute("PRAGMA table_info(ai_usage_logs)");
console.log(
  "columns:",
  info.rows.map((r) => r.name).join(", "),
);
console.log("Schema applied.");
