import { NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { documents, users } from "@/lib/db/schema";
import { deletePdf } from "@/lib/storage-backend";

export async function GET() {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const docs = await db.query.documents.findMany({
    where: (d, { eq, and, isNotNull }) =>
      and(eq(d.userId, user.id), isNotNull(d.fileUrl)),
    orderBy: (d, { desc }) => [desc(d.createdAt)],
  });

  return NextResponse.json(
    docs.map((d) => ({
      id: d.id,
      title: d.title ?? "Untitled",
      fileUrl: d.fileUrl,
      totalPages: d.totalPages ?? null,
      chapterPageRanges: d.chapterPageRanges ? JSON.parse(d.chapterPageRanges) : null,
      pageOffset: d.pageOffset ?? 0,
      createdAt: d.createdAt?.toISOString() ?? null,
    }))
  );
}

export async function DELETE(request: Request) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const doc = await db.query.documents.findFirst({
    where: (d, { eq, and }) => and(eq(d.id, id), eq(d.userId, user.id)),
  });

  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Delete from whichever backend hosts the URL (handles legacy VB
  // URLs and new R2 URLs during/after migration).
  if (doc.fileUrl) {
    await deletePdf(doc.fileUrl).catch(() => {});
  }

  await db.delete(documents).where(and(eq(documents.id, id), eq(documents.userId, user.id)));

  // ── Subtract from running storage total ──────────────────────────────
  if (doc.fileSizeBytes && doc.fileSizeBytes > 0) {
    await db
      .update(users)
      .set({ storageBytes: sql`MAX(0, COALESCE(storage_bytes, 0) - ${doc.fileSizeBytes})` })
      .where(eq(users.id, user.id));
  }

  return NextResponse.json({ ok: true });
}
