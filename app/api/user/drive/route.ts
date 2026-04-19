import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { del } from "@vercel/blob";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const docs = await db.query.documents.findMany({
    where: (d, { eq, and, isNotNull }) =>
      and(eq(d.userId, session.user.id), isNotNull(d.fileUrl)),
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
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const doc = await db.query.documents.findFirst({
    where: (d, { eq, and }) => and(eq(d.id, id), eq(d.userId, session.user.id)),
  });

  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Delete the blob from Vercel Blob storage
  if (doc.fileUrl) {
    await del(doc.fileUrl).catch(() => {});
  }

  await db.delete(documents).where(and(eq(documents.id, id), eq(documents.userId, session.user.id)));

  return NextResponse.json({ ok: true });
}
