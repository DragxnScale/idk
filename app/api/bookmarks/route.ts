import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { bookmarks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const documentId = req.nextUrl.searchParams.get("documentId");
  if (!documentId) {
    return NextResponse.json({ error: "documentId required" }, { status: 400 });
  }

  const rows = await db.query.bookmarks.findMany({
    where: (b, { and: a, eq: e }) =>
      a(e(b.userId, session.user.id), e(b.documentId, documentId)),
    orderBy: (b, { asc }) => asc(b.pageNumber),
  });

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { documentId, pageNumber, type, label, highlightText, color } = body;

  if (!documentId || !pageNumber || !type) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  if (type === "bookmark") {
    const existing = await db.query.bookmarks.findFirst({
      where: (b, { and: a, eq: e }) =>
        a(
          e(b.userId, session.user.id),
          e(b.documentId, documentId),
          e(b.pageNumber, pageNumber),
          e(b.type, "bookmark")
        ),
    });
    if (existing) {
      return NextResponse.json(existing);
    }
  }

  const id = randomUUID();
  const row = {
    id,
    userId: session.user.id,
    documentId,
    pageNumber,
    type,
    label: label ?? null,
    highlightText: highlightText ?? null,
    color: color ?? null,
    createdAt: new Date(),
  };

  await db.insert(bookmarks).values(row);
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await db
    .delete(bookmarks)
    .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, session.user.id)));

  return NextResponse.json({ ok: true });
}
