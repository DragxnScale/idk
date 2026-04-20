import { NextRequest, NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { pageVisits, studySessions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { sessionId, pageNumber, enteredAt, leftAt, durationSeconds } = body;

  if (!sessionId || !pageNumber || !enteredAt) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const studySession = await db.query.studySessions.findFirst({
    where: (s, { eq: e, and: a }) => a(e(s.id, sessionId), e(s.userId, user.id)),
  });
  if (!studySession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const id = randomUUID();
  await db.insert(pageVisits).values({
    id,
    sessionId,
    pageNumber,
    enteredAt: new Date(enteredAt),
    leftAt: leftAt ? new Date(leftAt) : null,
    durationSeconds: durationSeconds ?? null,
  });

  return NextResponse.json({ id }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, leftAt, durationSeconds } = body;

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (leftAt) updates.leftAt = new Date(leftAt);
  if (typeof durationSeconds === "number") updates.durationSeconds = durationSeconds;

  if (Object.keys(updates).length > 0) {
    await db.update(pageVisits).set(updates).where(eq(pageVisits.id, id));
  }

  return NextResponse.json({ ok: true });
}
