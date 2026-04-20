import { NextRequest, NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { bookmarks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function GET(req: NextRequest) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const documentId = req.nextUrl.searchParams.get("documentId");
  const sessionId = req.nextUrl.searchParams.get("sessionId");

  if (!documentId) {
    return NextResponse.json({ error: "documentId required" }, { status: 400 });
  }

  const conditions = [
    eq(bookmarks.userId, user.id),
    eq(bookmarks.documentId, documentId),
  ];

  if (sessionId) {
    conditions.push(eq(bookmarks.sessionId, sessionId));
  }

  const rows = await db.query.bookmarks.findMany({
    where: and(...conditions),
    orderBy: (b, { asc }) => asc(b.pageNumber),
  });

  return NextResponse.json(rows);
}

// GET all bookmarks for a user (for dashboard)
export async function POST(req: NextRequest) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { documentId, pageNumber, type, label, highlightText, color, tag, sessionId } = body;

  if (!documentId || !pageNumber || !type) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  if (type === "bookmark" && sessionId) {
    const existing = await db.query.bookmarks.findFirst({
      where: (b, { and: a, eq: e }) =>
        a(
          e(b.userId, user.id),
          e(b.documentId, documentId),
          e(b.pageNumber, pageNumber),
          e(b.type, "bookmark"),
          e(b.sessionId, sessionId)
        ),
    });
    if (existing) {
      return NextResponse.json(existing);
    }
  }

  const id = randomUUID();
  const row = {
    id,
    userId: user.id,
    sessionId: sessionId ?? null,
    documentId,
    pageNumber,
    type,
    label: label ?? null,
    highlightText: highlightText ?? null,
    color: color ?? null,
    tag: tag ?? null,
    createdAt: new Date(),
  };

  await db.insert(bookmarks).values(row);
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, tag } = body;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await db
    .update(bookmarks)
    .set({ tag: tag ?? null })
    .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, user.id)));

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await db
    .delete(bookmarks)
    .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, user.id)));

  return NextResponse.json({ ok: true });
}
