/**
 * POST /api/admin/catalog/cleanup-blobs
 *
 * Finds every documents row that was a per-user catalog copy
 * (sourceType = "textbook", fileUrl set), deletes the Vercel Blob object,
 * and removes the DB row.  Also clears cachedBlobUrl from textbook_catalog
 * rows so the old global copies are released too.
 *
 * Returns counts of rows deleted and bytes freed.
 */
import { NextResponse } from "next/server";
import { isNotNull, eq } from "drizzle-orm";
import { del } from "@vercel/blob";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { documents, textbookCatalog } from "@/lib/db/schema";
import { formatBytes } from "@/lib/storage";

export async function POST() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // ── 1. Delete per-user catalog document copies ───────────────────────
  const catalogDocs = await db.query.documents.findMany({
    where: (d, { and, eq: e, isNotNull: inn }) =>
      and(e(d.sourceType, "textbook"), inn(d.fileUrl)),
    columns: { id: true, fileUrl: true, fileSizeBytes: true },
  });

  let deletedRows = 0;
  let freedBytes = 0;
  const errors: string[] = [];

  for (const doc of catalogDocs) {
    if (doc.fileUrl) {
      try {
        await del(doc.fileUrl);
      } catch {
        errors.push(`Blob delete failed: ${doc.fileUrl}`);
      }
    }
    await db.delete(documents).where(eq(documents.id, doc.id));
    deletedRows++;
    freedBytes += doc.fileSizeBytes ?? 0;
  }

  // ── 2. Clear global cachedBlobUrl from catalog rows ──────────────────
  const catalogRows = await db.query.textbookCatalog.findMany({
    where: (t) => isNotNull(t.cachedBlobUrl),
    columns: { id: true, cachedBlobUrl: true },
  });

  let clearedCatalogBlobs = 0;
  for (const row of catalogRows) {
    if (row.cachedBlobUrl) {
      try {
        await del(row.cachedBlobUrl);
      } catch {
        errors.push(`Catalog blob delete failed: ${row.cachedBlobUrl}`);
      }
      await db
        .update(textbookCatalog)
        .set({ cachedBlobUrl: null })
        .where(eq(textbookCatalog.id, row.id));
      clearedCatalogBlobs++;
    }
  }

  return NextResponse.json({
    ok: true,
    deletedDocumentRows: deletedRows,
    clearedCatalogCaches: clearedCatalogBlobs,
    estimatedFreedBytes: freedBytes,
    estimatedFreedFormatted: formatBytes(freedBytes),
    errors: errors.length ? errors : undefined,
  });
}
