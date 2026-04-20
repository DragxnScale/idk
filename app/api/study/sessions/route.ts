import { NextResponse } from "next/server";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { studyGoals, studySessions } from "@/lib/db/schema";

function sessionIsLive(state: string | null | undefined) {
  return (state ?? "live") !== "paused";
}

async function maybeCompleteStudyGoal(goalId: string, userId: string) {
  const goal = await db.query.studyGoals.findFirst({
    where: (g, { eq: e, and: a }) => a(e(g.id, goalId), e(g.userId, userId)),
  });
  if (!goal || goal.status !== "active") return;

  const [agg] = await db
    .select({
      total: sql<number>`coalesce(sum(${studySessions.totalFocusedMinutes}), 0)`,
    })
    .from(studySessions)
    .where(
      and(
        eq(studySessions.studyGoalId, goalId),
        isNotNull(studySessions.endedAt)
      )
    );

  const total = Number(agg?.total ?? 0);
  if (total >= goal.targetValue) {
    await db
      .update(studyGoals)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(studyGoals.id, goalId));
  }
}

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
  const continueStudyGoalId = body.continueStudyGoalId as string | undefined;
  const newMultiSessionGoal = body.newMultiSessionGoal as
    | { targetTotalMinutes: number }
    | undefined;
  // Optional: client sends the real start time when syncing an offline session
  const startedAt = body.startedAt ? new Date(body.startedAt) : new Date();

  if (!goalType || targetValue == null) {
    return NextResponse.json(
      { error: "goalType and targetValue are required" },
      { status: 400 }
    );
  }

  if (continueStudyGoalId && newMultiSessionGoal) {
    return NextResponse.json(
      { error: "Use either continueStudyGoalId or newMultiSessionGoal, not both" },
      { status: 400 }
    );
  }

  if (newMultiSessionGoal && goalType !== "time") {
    return NextResponse.json(
      { error: "Multi-session goals are only supported for time goals" },
      { status: 400 }
    );
  }

  let linkedStudyGoalId: string | null = null;

  if (newMultiSessionGoal) {
    const mins = newMultiSessionGoal.targetTotalMinutes;
    if (typeof mins !== "number" || mins < 1 || mins > 100_000) {
      return NextResponse.json(
        { error: "newMultiSessionGoal.targetTotalMinutes must be between 1 and 100000" },
        { status: 400 }
      );
    }
    const gid = crypto.randomUUID();
    const now = new Date();
    await db.insert(studyGoals).values({
      id: gid,
      userId: user.id,
      goalType: "time",
      targetValue: mins,
      documentJson: documentJson ? JSON.stringify(documentJson) : null,
      status: "active",
      createdAt: now,
    });
    linkedStudyGoalId = gid;
  }

  if (continueStudyGoalId) {
    const g = await db.query.studyGoals.findFirst({
      where: (row, { eq: e, and: a }) =>
        a(e(row.id, continueStudyGoalId), e(row.userId, user.id)),
    });
    if (!g || g.status !== "active") {
      return NextResponse.json(
        { error: "Study goal not found or already completed" },
        { status: 400 }
      );
    }
    if (g.goalType !== "time") {
      return NextResponse.json(
        { error: "Only time-based study goals can be continued" },
        { status: 400 }
      );
    }
    linkedStudyGoalId = continueStudyGoalId;
  }

  // Auto-close any stale *live* active sessions (leave paused sessions intact)
  const allSessions = await db.query.studySessions.findMany({
    where: (s, { eq: e }) => e(s.userId, user.id),
  });
  const activeSessions = allSessions.filter(
    (s) => !s.endedAt && sessionIsLive(s.sessionState)
  );
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
    sessionState: "live",
    studyGoalId: linkedStudyGoalId,
  });

  return NextResponse.json({
    id,
    goalType,
    targetValue,
    startedAt: now.toISOString(),
    studyGoalId: linkedStudyGoalId,
  });
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
  if (body.sessionState === "live" || body.sessionState === "paused") {
    updates.sessionState = body.sessionState;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(existing);
  }

  await db
    .update(studySessions)
    .set(updates)
    .where(eq(studySessions.id, sessionId));

  if (updates.endedAt != null && existing.studyGoalId) {
    await maybeCompleteStudyGoal(existing.studyGoalId, user.id);
  }

  return NextResponse.json({ ok: true, ...updates });
}
