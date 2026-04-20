import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { studySessions } from "@/lib/db/schema";

// ── GET: list the current user's study sessions ──────────────────────

export async function GET() {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.query.studySessions.findMany({
    where: (s, { eq: e }) => e(s.userId, user.id),
  });

  rows.sort(
    (a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0)
  );

  return NextResponse.json(rows.slice(0, 50));
}

// ── POST: start a new study session ──────────────────────────────────

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const goalType = body.goalType as string;
  const targetValue = body.targetValue as number;
  const documentJson = body.documentJson ?? null;
  // Optional: client sends the real start time when syncing an offline session
  const startedAt = body.startedAt ? new Date(body.startedAt) : new Date();

  if (!goalType || targetValue == null) {
    return NextResponse.json(
      { error: "goalType and targetValue are required" },
      { status: 400 }
    );
  }

  // Auto-close any stale active sessions for this user
  const allSessions = await db.query.studySessions.findMany({
    where: (s, { eq: e }) => e(s.userId, user.id),
  });
  const activeSessions = allSessions.filter((s) => !s.endedAt);
  for (const active of activeSessions) {
    await db
      .update(studySessions)
      .set({
        endedAt: new Date(),
        totalFocusedMinutes: active.totalFocusedMinutes ?? 0,
      })
      .where(eq(studySessions.id, active.id));
  }

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(studySessions).values({
    id,
    userId: user.id,
    goalType,
    targetValue,
    documentJson: documentJson ? JSON.stringify(documentJson) : null,
    startedAt,
    createdAt: now,
  });

  return NextResponse.json({ id, goalType, targetValue, startedAt: now.toISOString() });
}

// ── PATCH: update a study session (progress or end) ──────────────────

export async function PATCH(request: Request) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const sessionId = body.sessionId as string;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const existing = await db.query.studySessions.findFirst({
    where: (s, { eq: e, and }) =>
      and(e(s.id, sessionId), e(s.userId, user.id)),
  });

  if (!existing) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if (body.endedAt != null) updates.endedAt = new Date(body.endedAt);
  if (typeof body.totalFocusedMinutes === "number")
    updates.totalFocusedMinutes = body.totalFocusedMinutes;
  if (typeof body.lastPageIndex === "number")
    updates.lastPageIndex = body.lastPageIndex;
  if (typeof body.pagesVisited === "number")
    updates.pagesVisited = body.pagesVisited;
  if (Array.isArray(body.visitedPagesList))
    updates.visitedPagesList = JSON.stringify(body.visitedPagesList);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(existing);
  }

  await db
    .update(studySessions)
    .set(updates)
    .where(eq(studySessions.id, sessionId));

  return NextResponse.json({ ok: true, ...updates });
}
