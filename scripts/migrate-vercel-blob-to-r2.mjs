/**
 * One-shot migration: copy every Vercel Blob PDF into Cloudflare R2 and
 * rewrite the URL columns that point at it.
 *
 * Run from the project root with `.env.local` populated:
 *
 *   node scripts/migrate-vercel-blob-to-r2.mjs           # dry-run
 *   node scripts/migrate-vercel-blob-to-r2.mjs --execute # actually copy + rewrite
 *   node scripts/migrate-vercel-blob-to-r2.mjs --execute --delete-source
 *       # also delete from Vercel Blob after a successful copy.
 *       # Recommended only after at least one prod cutover smoke test.
 *
 * URLs rewritten:
 *   documents.file_url
 *   textbook_catalog.cached_blob_url
 *   textbook_catalog.source_url   (only when it points at blob.vercel-storage.com)
 */
import { list, del } from "@vercel/blob";
import {
  S3Client,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

// ── 1. Load .env.local manually (no dotenv dep) ──────────────────────
try {
  const envContent = readFileSync(".env.local", "utf8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] ||= match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
} catch {}

const args = new Set(process.argv.slice(2));
const EXECUTE = args.has("--execute");
const DELETE_SOURCE = args.has("--delete-source");

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const BLOB_TOKEN = need("BLOB_READ_WRITE_TOKEN");
const R2_ENDPOINT = need("R2_ENDPOINT");
const R2_ACCESS_KEY_ID = need("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = need("R2_SECRET_ACCESS_KEY");
const R2_BUCKET = need("R2_BUCKET");
const DATABASE_URL = need("DATABASE_URL");

const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

const db = createClient({
  url: DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

function r2EndpointUrl(key) {
  return `${R2_ENDPOINT.replace(/\/+$/, "")}/${R2_BUCKET}/${key}`;
}

async function r2HasObject(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

// ── 2. Enumerate Vercel Blob objects ────────────────────────────────
console.log(EXECUTE ? "EXECUTE mode" : "DRY RUN — pass --execute to copy + rewrite");
console.log("");

const allBlobs = [];
{
  let cursor;
  do {
    const res = await list({ cursor, limit: 100, token: BLOB_TOKEN });
    for (const b of res.blobs) allBlobs.push(b);
    cursor = res.hasMore ? res.cursor : undefined;
  } while (cursor);
}
console.log(`Vercel Blob: ${allBlobs.length} objects`);

// ── 3. Copy each blob to R2 ─────────────────────────────────────────
const copied = []; // { url, newUrl, pathname, size }
let skipped = 0;
let failed = 0;

for (const b of allBlobs) {
  const key = b.pathname;
  const sizeMB = (b.size / 1024 / 1024).toFixed(1);
  process.stdout.write(`  ${key.padEnd(60)} ${sizeMB.padStart(7)} MB  `);

  if (!EXECUTE) {
    console.log("(dry-run)");
    copied.push({ url: b.url, newUrl: r2EndpointUrl(key), pathname: key, size: b.size });
    continue;
  }

  if (await r2HasObject(key)) {
    console.log("already in R2 — skip");
    copied.push({ url: b.url, newUrl: r2EndpointUrl(key), pathname: key, size: b.size });
    skipped++;
    continue;
  }

  try {
    const res = await fetch(b.url, {
      headers: { Authorization: `Bearer ${BLOB_TOKEN}` },
    });
    if (!res.ok || !res.body) throw new Error(`download ${res.status}`);

    // Stream the fetch body straight into a multipart upload so we
    // never hold the whole PDF in RAM and the connection can recover
    // from intermittent stalls between parts.
    const upload = new Upload({
      client: s3,
      params: {
        Bucket: R2_BUCKET,
        Key: key,
        Body: res.body,
        ContentType: "application/pdf",
      },
      partSize: 8 * 1024 * 1024,
      queueSize: 4,
    });
    await upload.done();

    console.log("✓ copied");
    copied.push({ url: b.url, newUrl: r2EndpointUrl(key), pathname: key, size: b.size });
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
    failed++;
  }
}

console.log("");
console.log(`Copied: ${copied.length - skipped}, skipped: ${skipped}, failed: ${failed}`);

// ── 4. Rewrite DB rows ──────────────────────────────────────────────
let rewritten = 0;
const urlMap = new Map(copied.map((c) => [c.url, c.newUrl]));

async function rewriteColumn(table, column) {
  const result = await db.execute(
    `SELECT id, ${column} AS u FROM ${table} WHERE ${column} LIKE '%blob.vercel-storage.com%'`
  );
  console.log(`${table}.${column}: ${result.rows.length} rows pointing at Vercel Blob`);
  for (const row of result.rows) {
    const oldUrl = String(row.u);
    const newUrl = urlMap.get(oldUrl);
    if (!newUrl) {
      console.log(`  ${row.id}: NO MATCH in R2 — skipping`);
      continue;
    }
    if (!EXECUTE) {
      console.log(`  ${row.id}: would rewrite → ${newUrl.slice(0, 80)}…`);
      continue;
    }
    await db.execute({
      sql: `UPDATE ${table} SET ${column} = ? WHERE id = ?`,
      args: [newUrl, String(row.id)],
    });
    rewritten++;
  }
}

console.log("");
await rewriteColumn("documents", "file_url");
await rewriteColumn("textbook_catalog", "cached_blob_url");
await rewriteColumn("textbook_catalog", "source_url");

console.log("");
console.log(`DB rows rewritten: ${rewritten}`);

// ── 5. (optional) delete the now-orphaned Vercel Blob objects ───────
if (DELETE_SOURCE && EXECUTE) {
  console.log("");
  console.log("Deleting from Vercel Blob (--delete-source)…");
  let deleted = 0;
  for (const c of copied) {
    try {
      await del(c.url, { token: BLOB_TOKEN });
      deleted++;
    } catch (e) {
      console.log(`  fail to delete ${c.url}: ${e.message}`);
    }
  }
  console.log(`Deleted from Vercel Blob: ${deleted}`);
}

console.log("");
console.log("Done.");
process.exit(0);
