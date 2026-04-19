import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

type Params = { params: Promise<{ id: string }> };

/** GET — return document metadata (owner or admin only) */
export async function GET(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const doc = await db.query.documents.findFirst({
    where: (d, { eq }) => eq(d.id, id),
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = await isAdmin(session.user.id);
  if (doc.userId !== session.user.id && !admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    id: doc.id,
    title: doc.title,
    fileUrl: doc.fileUrl,
    totalPages: doc.totalPages,
    chapterPageRanges: doc.chapterPageRanges ? JSON.parse(doc.chapterPageRanges) : null,
    pageOffset: doc.pageOffset ?? 0,
    createdAt: doc.createdAt?.toISOString() ?? null,
  });
}

/**
 * PATCH — update TOC (chapterPageRanges) and/or pageOffset.
 * Only the document owner or an admin may update.
 */
export async function PATCH(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const doc = await db.query.documents.findFirst({
    where: (d, { eq }) => eq(d.id, id),
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = await isAdmin(session.user.id);
  if (doc.userId !== session.user.id && !admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json() as {
    chapterPageRanges?: Record<string, [number, number]>;
    pageOffset?: number;
    title?: string;
  };

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.chapterPageRanges !== undefined) {
    updates.chapterPageRanges = JSON.stringify(body.chapterPageRanges);
  }
  if (typeof body.pageOffset === "number") {
    updates.pageOffset = body.pageOffset;
  }
  if (typeof body.title === "string" && body.title.trim()) {
    updates.title = body.title.trim();
  }

  await db
    .update(documents)
    .set(updates)
    .where(and(eq(documents.id, id), eq(documents.userId, doc.userId)));

  return NextResponse.json({ ok: true });
}
