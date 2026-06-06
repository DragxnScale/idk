/**
 * Applies per-upload document AI cache tables + flashcards.document_id.
 *
 *   node scripts/apply-document-ai-cache.mjs
 *
 * Idempotent: CREATE IF NOT EXISTS + ALTER wrapped in try/catch for
 * duplicate-column errors.
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
  `CREATE TABLE IF NOT EXISTS document_notes (
    id TEXT PRIMARY KEY NOT NULL,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    prompt_version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER,
    updated_at INTEGER,
    UNIQUE(document_id, page_number)
  )`,
  `CREATE TABLE IF NOT EXISTS document_quiz_questions (
    id TEXT PRIMARY KEY NOT NULL,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_index INTEGER NOT NULL DEFAULT 0,
    question_json TEXT NOT NULL,
    created_at INTEGER
  )`,
  "CREATE INDEX IF NOT EXISTS document_quiz_questions_doc_page_idx ON document_quiz_questions (document_id, page_index)",
  "ALTER TABLE flashcards ADD COLUMN document_id TEXT REFERENCES documents(id) ON DELETE CASCADE",
  "CREATE INDEX IF NOT EXISTS flashcards_document_page_idx ON flashcards (document_id, page_number)",
  "CREATE UNIQUE INDEX IF NOT EXISTS flashcards_document_front_unique ON flashcards (document_id, front) WHERE document_id IS NOT NULL",
];

for (const sql of statements) {
  try {
    await c.execute(sql);
    console.log(`ok   ${sql.split("\n")[0]}…`);
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (
      msg.includes("duplicate column name") ||
      msg.includes("already exists")
    ) {
      console.log(`skip ${sql.split("\n")[0]}…  (already applied)`);
    } else {
      console.error(`FAIL ${sql}`);
      console.error(`     ${msg}`);
      process.exit(1);
    }
  }
}

console.log("");
const dn = await c.execute("SELECT count(*) AS n FROM document_notes");
const dq = await c.execute("SELECT count(*) AS n FROM document_quiz_questions");
const fc = await c.execute(
  "SELECT count(*) AS n FROM flashcards WHERE document_id IS NOT NULL"
);
console.log(`document_notes: ${dn.rows[0].n}`);
console.log(`document_quiz_questions: ${dq.rows[0].n}`);
console.log(`flashcards with document_id: ${fc.rows[0].n}`);
console.log("Schema applied.");
