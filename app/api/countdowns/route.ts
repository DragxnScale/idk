import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { examCountdowns } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.query.examCountdowns.findMany({
    where: (c, { eq: e }) => e(c.userId, session.user.id),
    orderBy: (c, { asc }) => asc(c.examDate),
  });

  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      examDate: r.examDate?.toISOString() ?? null,
      createdAt: r.createdAt?.toISOString() ?? null,
    }))
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { title, examDate, textbookCatalogId, totalPages } = body;

  if (!title || !examDate) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const id = randomUUID();
  const row = {
    id,
    userId: session.user.id,
    title,
    examDate: new Date(examDate),
    textbookCatalogId: textbookCatalogId ?? null,
    totalPages: totalPages ? Number(totalPages) : null,
    pagesCompleted: 0,
    createdAt: new Date(),
  };

  await db.insert(examCountdowns).values(row);
  return NextResponse.json({
    ...row,
    examDate: row.examDate.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, pagesCompleted } = body;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof pagesCompleted === "number") updates.pagesCompleted = pagesCompleted;

  await db
    .update(examCountdowns)
    .set(updates)
    .where(and(eq(examCountdowns.id, id), eq(examCountdowns.userId, session.user.id)));

  return NextResponse.json({ ok: true });
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
    .delete(examCountdowns)
    .where(and(eq(examCountdowns.id, id), eq(examCountdowns.userId, session.user.id)));

  return NextResponse.json({ ok: true });
}
