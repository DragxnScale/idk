import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { textbookCatalog } from "@/lib/db/schema";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
      createdAt: b.createdAt?.toISOString() ?? null,
    }))
  );
}

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { id, title, edition, isbn, sourceType, sourceUrl, chapterPageRanges } = body;

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
      },
    });

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
