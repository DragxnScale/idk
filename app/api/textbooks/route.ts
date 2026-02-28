import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { store } from "@/lib/store";
import { seedTextbooks } from "@/lib/db/seed-textbooks";

function ensureSeeded() {
  const existing = store.getTextbooks();
  if (existing.length === 0) {
    const now = new Date().toISOString();
    for (const book of seedTextbooks) {
      store.upsertTextbook({ ...book, createdAt: now });
    }
  }
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  ensureSeeded();

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.toLowerCase() ?? "";

  const all = store.getTextbooks();

  const results = q
    ? all.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          (b.edition ?? "").toLowerCase().includes(q) ||
          (b.isbn ?? "").includes(q)
      )
    : all;

  return NextResponse.json(
    results.map((b) => {
      const ranges: Record<string, [number, number]> = b.chapterPageRanges
        ? JSON.parse(b.chapterPageRanges)
        : {};
      return {
        id: b.id,
        title: b.title,
        edition: b.edition,
        isbn: b.isbn,
        sourceType: b.sourceType,
        sourceUrl: b.sourceUrl,
        chapters: Object.keys(ranges),
        chapterPageRanges: ranges,
      };
    })
  );
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  for (const book of seedTextbooks) {
    store.updateTextbook(book.id, {
      sourceType: book.sourceType,
      sourceUrl: book.sourceUrl,
      chapterPageRanges: book.chapterPageRanges,
    });
  }

  return NextResponse.json({ ok: true });
}
