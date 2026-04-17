/**
 * POST /api/documents/ensure-imported
 *
 * Given a textbook catalog URL + optional catalog id, checks whether the
 * current user already has a stored Blob copy.  If they do, returns it
 * immediately (cached: true).  If not, downloads the PDF, uploads it to
 * public Vercel Blob, creates a documents row, and returns the result
 * (cached: false).
 *
 * This removes the /api/proxy/pdf round-trip for every page read —
 * only the first open of a book costs origin bandwidth; afterwards the
 * browser loads bytes directly from Blob / CDN.
 */

import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

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

  // ── 1. Check for an existing stored copy ──────────────────────────────
  const existing = textbookCatalogId
    ? await db.query.documents.findFirst({
        where: and(
          eq(documents.userId, session.user.id),
          eq(documents.textbookCatalogId, textbookCatalogId)
        ),
      })
    : null;

  if (existing?.fileUrl) {
    return NextResponse.json({
      documentId: existing.id,
      fileUrl: existing.fileUrl,
      cached: true,
    });
  }

  // ── 2. Not cached — fetch from source and upload to Blob ──────────────
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
    const msg = (e as Error).message || "Network error";
    return NextResponse.json(
      { error: `Could not fetch PDF source: ${msg}` },
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

  const id = crypto.randomUUID();
  const safeTitle = (title ?? sourceUrl.split("/").pop() ?? "document")
    .replace(/\.pdf$/i, "")
    .slice(0, 120);
  const filename = `${session.user.id}/${id}.pdf`;

  let blob: Awaited<ReturnType<typeof put>>;
  try {
    blob = await put(filename, fetchRes.body!, {
      access: "public",
      contentType: "application/pdf",
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Blob upload failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  const now = new Date();
  await db.insert(documents).values({
    id,
    userId: session.user.id,
    title: safeTitle,
    sourceType: "textbook",
    textbookCatalogId: textbookCatalogId ?? null,
    fileUrl: blob.url,
    createdAt: now,
    updatedAt: now,
  });

  return NextResponse.json({
    documentId: id,
    fileUrl: blob.url,
    cached: false,
  });
}
