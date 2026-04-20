import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { textbookCatalog } from "@/lib/db/schema";
import { seedTextbooks, ensureSeeded } from "@/lib/db/seed-textbooks";

export async function GET(request: Request) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureSeeded();

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.toLowerCase() ?? "";

  const all = await db.query.textbookCatalog.findMany();
  const userId = user.id;

  // Hide from public: exclude hidden items unless current user is in visibleToUserIds
  const visible = all.filter((b) => {
    if (!b.hidden) return true;
    try {
      const ids: string[] = b.visibleToUserIds ? JSON.parse(b.visibleToUserIds) : [];
      return ids.includes(userId);
    } catch {
      return false;
    }
  });

  const results = q
    ? visible.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          (b.edition ?? "").toLowerCase().includes(q) ||
          (b.isbn ?? "").includes(q)
      )
    : visible;

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
  const user = await getAppUser();
  if (!user?.id) {
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
