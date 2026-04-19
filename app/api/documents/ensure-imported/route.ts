/**
 * POST /api/documents/ensure-imported
 *
 * Ensures a catalog PDF is available on public Vercel Blob CDN.
 * Uses a SINGLE GLOBAL cached copy per textbook_catalog row — stored in
 * textbookCatalog.cachedBlobUrl — instead of one copy per user.
 *
 * Flow:
 *   1. If catalog.cachedBlobUrl is already set → return it immediately (free).
 *   2. Otherwise, download from sourceUrl, upload to public Blob, save the URL
 *      on the catalog row → all future users get the cached URL at zero cost.
 *
 * This removes /api/proxy/pdf round-trips and prevents per-user blob duplication.
 */

import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { textbookCatalog } from "@/lib/db/schema";

const FETCH_TIMEOUT_MS = 90_000;
const MAX_PDF_BYTES = 500 * 1024 * 1024; // 500 MB

export const maxDuration = 120;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { sourceUrl?: string; title?: string; textbookCatalogId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sourceUrl, title, textbookCatalogId } = body;
  if (!sourceUrl || typeof sourceUrl !== "string") {
    return NextResponse.json({ error: "sourceUrl is required" }, { status: 400 });
  }
  if (!textbookCatalogId) {
    return NextResponse.json({ error: "textbookCatalogId is required" }, { status: 400 });
  }

  // ── 1. Check the global catalog cache ───────────────────────────────
  const catalog = await db.query.textbookCatalog.findFirst({
    where: eq(textbookCatalog.id, textbookCatalogId),
  });

  if (catalog?.cachedBlobUrl) {
    return NextResponse.json({
      fileUrl: catalog.cachedBlobUrl,
      cached: true,
    });
  }

  // ── 2. Download from source ─────────────────────────────────────────
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let fetchRes: Response;
  try {
    fetchRes = await fetch(sourceUrl, {
      headers: { "User-Agent": "BowlBeacon/1.0" },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return NextResponse.json(
      { error: `Could not fetch PDF source: ${(e as Error).message}` },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }

  if (!fetchRes.ok) {
    return NextResponse.json(
      { error: `Source returned HTTP ${fetchRes.status}` },
      { status: 502 }
    );
  }

  const contentLength = Number(fetchRes.headers.get("content-length") ?? 0);
  if (contentLength > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: `PDF is too large (${Math.round(contentLength / 1024 / 1024)} MB). Max 500 MB.` },
      { status: 413 }
    );
  }

  // ── 3. Upload to public Blob (one global copy) ───────────────────────
  const safeTitle = (title ?? sourceUrl.split("/").pop() ?? "document")
    .replace(/\.pdf$/i, "")
    .slice(0, 120);
  const filename = `catalog/${textbookCatalogId}/${safeTitle}.pdf`;

  let blobUrl: string;
  try {
    const blob = await put(filename, fetchRes.body!, {
      access: "public",
      contentType: "application/pdf",
    });
    blobUrl = blob.url;
  } catch (e) {
    return NextResponse.json(
      { error: `Blob upload failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  // ── 4. Save to catalog row ───────────────────────────────────────────
  await db
    .update(textbookCatalog)
    .set({ cachedBlobUrl: blobUrl })
    .where(eq(textbookCatalog.id, textbookCatalogId));

  return NextResponse.json({
    fileUrl: blobUrl,
    cached: false,
  });
}
