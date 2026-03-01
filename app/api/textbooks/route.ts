import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { textbookCatalog } from "@/lib/db/schema";
import { seedTextbooks } from "@/lib/db/seed-textbooks";

async function ensureSeeded() {
  // Only seed if the catalog is completely empty (first-ever run).
  // This prevents deleted entries from reappearing on every request.
  const existing = await db.query.textbookCatalog.findFirst();
  if (existing) return;

  const now = new Date();
  for (const book of seedTextbooks) {
    await db
      .insert(textbookCatalog)
      .values({ ...book, createdAt: now })
      .onConflictDoNothing();
  }
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureSeeded();

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.toLowerCase() ?? "";

  const all = await db.query.textbookCatalog.findMany();

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

  // Force re-seed by updating existing entries from seed data
  for (const book of seedTextbooks) {
    await db
      .update(textbookCatalog)
      .set({
        sourceType: book.sourceType,
        sourceUrl: book.sourceUrl,
        chapterPageRanges: book.chapterPageRanges,
      })
      .where(eq(textbookCatalog.id, book.id));
  }

  return NextResponse.json({ ok: true });
}
