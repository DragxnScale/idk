import { put, del } from "@vercel/blob";
import { createClient } from "@libsql/client";
import { readFileSync } from "fs";

// Load .env.local
const envContent = readFileSync(".env.local", "utf8");
for (const line of envContent.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
}

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const db = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

if (!BLOB_TOKEN) { console.error("Missing BLOB_READ_WRITE_TOKEN"); process.exit(1); }

const result = await db.execute(
  "SELECT id, title, source_url FROM textbook_catalog WHERE source_url LIKE '%private.blob.vercel-storage.com%'"
);

console.log(`Found ${result.rows.length} private textbook blobs to migrate.\n`);

for (const row of result.rows) {
  const { id, title, source_url: privateUrl } = row;
  console.log(`--- ${title} (${id}) ---`);
  console.log(`  Private URL: ${String(privateUrl).substring(0, 80)}...`);

  // Download from private blob
  console.log("  Downloading from private blob...");
  const res = await fetch(String(privateUrl), {
    headers: { Authorization: `Bearer ${BLOB_TOKEN}` },
  });

  if (!res.ok) {
    console.error(`  FAILED to download: ${res.status} ${res.statusText}`);
    continue;
  }

  const data = await res.arrayBuffer();
  const sizeMB = (data.byteLength / 1024 / 1024).toFixed(1);
  console.log(`  Downloaded ${sizeMB} MB`);

  // Extract pathname from the old URL
  const urlObj = new URL(String(privateUrl));
  const pathname = urlObj.pathname.startsWith("/") ? urlObj.pathname.slice(1) : urlObj.pathname;

  // Re-upload as public
  console.log(`  Uploading as public (pathname: ${pathname})...`);
  const blob = await put(pathname, Buffer.from(data), {
    access: "public",
    contentType: "application/pdf",
    token: BLOB_TOKEN,
    addRandomSuffix: false,
  });

  console.log(`  New public URL: ${blob.url}`);

  // Update database
  await db.execute({
    sql: "UPDATE textbook_catalog SET source_url = ? WHERE id = ?",
    args: [blob.url, String(id)],
  });
  console.log("  Database updated.");

  // Delete old private blob
  try {
    await del(String(privateUrl), { token: BLOB_TOKEN });
    console.log("  Old private blob deleted.");
  } catch (e) {
    console.warn(`  Warning: could not delete old blob: ${e.message}`);
  }

  console.log("");
}

console.log("Migration complete!");
