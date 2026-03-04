import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { textbookCatalog } from "@/lib/db/schema";
import { ensureSeeded } from "@/lib/db/seed-textbooks";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await ensureSeeded();

  const all = await db.query.textbookCatalog.findMany({
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });

  return NextResponse.json(
    all.map((b) => ({
      id: b.id,
      title: b.title,
      edition: b.edition ?? null,
      isbn: b.isbn ?? null,
      sourceType: b.sourceType,
      sourceUrl: b.sourceUrl ?? null,
      chapterPageRanges: b.chapterPageRanges ? JSON.parse(b.chapterPageRanges) : {},
      pageOffset: b.pageOffset ?? 0,
      hidden: b.hidden ?? false,
      visibleToUserIds: b.visibleToUserIds ? JSON.parse(b.visibleToUserIds) : [],
      createdAt: b.createdAt?.toISOString() ?? null,
    }))
  );
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { id, title, edition, isbn, sourceType, sourceUrl, chapterPageRanges, pageOffset } = body;

  if (!id || !title || !sourceType) {
    return NextResponse.json({ error: "id, title and sourceType are required" }, { status: 400 });
  }

  await db
    .insert(textbookCatalog)
    .values({
      id,
      title,
      edition: edition || null,
      isbn: isbn || null,
      sourceType,
      sourceUrl: sourceUrl || null,
      chapterPageRanges: chapterPageRanges ? JSON.stringify(chapterPageRanges) : null,
      pageOffset: typeof pageOffset === "number" ? pageOffset : 0,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: textbookCatalog.id,
      set: {
        title,
        edition: edition || null,
        isbn: isbn || null,
        sourceType,
        sourceUrl: sourceUrl || null,
        chapterPageRanges: chapterPageRanges ? JSON.stringify(chapterPageRanges) : null,
        pageOffset: typeof pageOffset === "number" ? pageOffset : 0,
      },
    });

  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { id } = body;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // Build a partial update object from whatever fields are provided
  const updates: Record<string, unknown> = {};

  if (typeof body.hidden === "boolean") {
    updates.hidden = body.hidden;
    updates.visibleToUserIds = Array.isArray(body.visibleToUserIds)
      ? JSON.stringify(body.visibleToUserIds)
      : "[]";
  }
  if (body.chapterPageRanges !== undefined) {
    updates.chapterPageRanges = body.chapterPageRanges
      ? JSON.stringify(body.chapterPageRanges)
      : null;
  }
  if (typeof body.pageOffset === "number") {
    updates.pageOffset = body.pageOffset;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  await db
    .update(textbookCatalog)
    .set(updates)
    .where(eq(textbookCatalog.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await db.delete(textbookCatalog).where(eq(textbookCatalog.id, id));
  return NextResponse.json({ ok: true });
}
