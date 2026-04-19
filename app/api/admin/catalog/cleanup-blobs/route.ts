/**
 * GET  /api/admin/catalog/cleanup-blobs  — preview: counts what would be deleted
 * POST /api/admin/catalog/cleanup-blobs  — execute: deletes catalog blobs and recalcs storage
 */
import { NextResponse } from "next/server";
import { isNotNull, eq, and, sql } from "drizzle-orm";
import { del } from "@vercel/blob";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { documents, textbookCatalog, users } from "@/lib/db/schema";
import { formatBytes } from "@/lib/storage";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const catalogDocs = await db.query.documents.findMany({
    where: (d, { and: a, eq: e, isNotNull: inn }) =>
      a(e(d.sourceType, "textbook"), inn(d.fileUrl)),
    columns: { id: true, fileSizeBytes: true },
  });

  const catalogBlobRows = await db.query.textbookCatalog.findMany({
    where: (t) => isNotNull(t.cachedBlobUrl),
    columns: { id: true },
  });

  const estimatedBytes = catalogDocs.reduce((s, d) => s + (d.fileSizeBytes ?? 0), 0);

  return NextResponse.json({
    catalogDocumentRowsToDelete: catalogDocs.length,
    catalogCacheBlobsToDelete: catalogBlobRows.length,
    estimatedFreedFormatted: formatBytes(estimatedBytes),
    note: "Run POST to execute cleanup.",
  });
}

export async function POST() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // ── 1. Find and delete per-user catalog document blobs + rows ────────
  const catalogDocs = await db.query.documents.findMany({
    where: (d, { and: a, eq: e, isNotNull: inn }) =>
      a(e(d.sourceType, "textbook"), inn(d.fileUrl)),
    columns: { id: true, userId: true, fileUrl: true, fileSizeBytes: true },
  });

  let deletedRows = 0;
  let freedBytes = 0;
  const errors: string[] = [];

  for (const doc of catalogDocs) {
    if (doc.fileUrl) {
      try { await del(doc.fileUrl); } catch { errors.push(`blob: ${doc.fileUrl}`); }
    }
    await db.delete(documents).where(eq(documents.id, doc.id));
    deletedRows++;
    freedBytes += doc.fileSizeBytes ?? 0;
  }

  // ── 2. Clear global cachedBlobUrl from catalog rows ──────────────────
  const catalogBlobRows = await db.query.textbookCatalog.findMany({
    where: (t) => isNotNull(t.cachedBlobUrl),
    columns: { id: true, cachedBlobUrl: true },
  });

  for (const row of catalogBlobRows) {
    if (row.cachedBlobUrl) {
      try { await del(row.cachedBlobUrl); } catch { errors.push(`catalog blob: ${row.cachedBlobUrl}`); }
      await db.update(textbookCatalog).set({ cachedBlobUrl: null }).where(eq(textbookCatalog.id, row.id));
    }
  }

  // ── 3. Recalculate storageBytes for all affected users ───────────────
  // Get unique user IDs from deleted rows
  const affectedUserIds = Array.from(new Set(catalogDocs.map((d) => d.userId)));
  for (const userId of affectedUserIds) {
    const [usageRow] = await db
      .select({ total: sql<number>`COALESCE(SUM(file_size_bytes), 0)` })
      .from(documents)
      .where(and(eq(documents.userId, userId), eq(documents.sourceType, "upload")));
    await db
      .update(users)
      .set({ storageBytes: Number(usageRow?.total ?? 0) })
      .where(eq(users.id, userId));
  }

  return NextResponse.json({
    ok: true,
    deletedDocumentRows: deletedRows,
    clearedCatalogCaches: catalogBlobRows.length,
    estimatedFreedFormatted: formatBytes(freedBytes),
    recalculatedUsers: affectedUserIds.length,
    errors: errors.length ? errors : undefined,
  });
}
