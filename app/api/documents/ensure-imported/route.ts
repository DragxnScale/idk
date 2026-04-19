/**
 * POST /api/documents/ensure-imported
 *
 * Returns the URL the client should use to load a catalog PDF.
 *
 * Strategy: use the authenticated proxy route (/api/proxy/pdf) rather than
 * storing the PDF in Vercel Blob.  The proxy sets a 30-day Vercel edge CDN
 * cache (s-maxage=2592000), so after the first request per edge region the
 * bytes are served from the CDN at zero Fast Origin Transfer cost — identical
 * performance to a blob URL with zero blob storage overhead.
 *
 * If a cachedBlobUrl was already stored on the catalog row from the previous
 * approach, we return that instead (free CDN delivery, no proxy hop needed).
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { textbookCatalog } from "@/lib/db/schema";

export const maxDuration = 10;

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

  const { sourceUrl, textbookCatalogId } = body;
  if (!sourceUrl || typeof sourceUrl !== "string") {
    return NextResponse.json({ error: "sourceUrl is required" }, { status: 400 });
  }

  // If an already-uploaded global blob exists, use it (free CDN, fastest path)
  if (textbookCatalogId) {
    const catalog = await db.query.textbookCatalog.findFirst({
      where: eq(textbookCatalog.id, textbookCatalogId),
      columns: { cachedBlobUrl: true },
    });
    if (catalog?.cachedBlobUrl) {
      return NextResponse.json({ fileUrl: catalog.cachedBlobUrl, cached: true });
    }
  }

  // Otherwise return the authenticated proxy URL — Vercel edge CDN caches the
  // response for 30 days, so each unique byte range is only fetched from the
  // origin once per edge region.
  const proxyUrl = `/api/proxy/pdf?url=${encodeURIComponent(sourceUrl)}`;
  return NextResponse.json({ fileUrl: proxyUrl, cached: false });
}
