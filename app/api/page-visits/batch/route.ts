import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { pageVisits, studySessions } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { visits } = await req.json();
  if (!Array.isArray(visits) || visits.length === 0) {
    return NextResponse.json({ error: "visits array required" }, { status: 400 });
  }

  const sessionIds = Array.from(new Set(visits.map((v: { sessionId: string }) => v.sessionId)));
  const owned = await db
    .select({ id: studySessions.id })
    .from(studySessions)
    .where(and(inArray(studySessions.id, sessionIds), eq(studySessions.userId, session.user.id)));
  const ownedIds = new Set(owned.map((r) => r.id));

  const rows = visits
    .filter((v: { sessionId: string }) => ownedIds.has(v.sessionId))
    .map((v: { sessionId: string; pageNumber: number; enteredAt: string; leftAt?: string; durationSeconds?: number }) => ({
      id: randomUUID(),
      sessionId: v.sessionId,
      pageNumber: v.pageNumber,
      enteredAt: new Date(v.enteredAt),
      leftAt: v.leftAt ? new Date(v.leftAt) : null,
      durationSeconds: v.durationSeconds ?? null,
    }));

  for (const row of rows) {
    await db.insert(pageVisits).values(row);
  }

  return NextResponse.json({ inserted: rows.length }, { status: 201 });
}
