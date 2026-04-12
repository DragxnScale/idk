import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin";

export async function GET() {
  let session;
  try {
    session = await auth();
  } catch (e) {
    console.error("[study/stats] auth error:", e);
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {

  let rows, user;
  try {
    [rows, user] = await Promise.all([
      db.query.studySessions.findMany({
        where: (s, { eq }) => eq(s.userId, session.user.id),
      }),
      db.query.users.findFirst({
        where: (u, { eq }) => eq(u.id, session.user.id),
      }),
    ]);
  } catch (dbErr) {
    console.error("[study/stats] database error:", dbErr);
    return NextResponse.json(
      { error: "Database error" },
      { status: 500 }
    );
  }

  const completed = rows.filter((r) => r.endedAt);
  const totalMinutes = completed.reduce(
    (sum, r) => sum + (r.totalFocusedMinutes ?? 0),
    0
  );
  const totalPages = completed.reduce(
    (sum, r) => sum + (r.pagesVisited ?? 0),
    0
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);

  const weekDays: { date: string; minutes: number; sessions: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekAgo);
    d.setDate(d.getDate() + i);
    const dayStr = d.toISOString().slice(0, 10);

    const daySessions = completed.filter((r) => {
      if (!r.startedAt) return false;
      return r.startedAt.toISOString().slice(0, 10) === dayStr;
    });

    weekDays.push({
      date: dayStr,
      minutes: daySessions.reduce(
        (s, r) => s + (r.totalFocusedMinutes ?? 0),
        0
      ),
      sessions: daySessions.length,
    });
  }

  let streak = 0;
  const daySet = new Set(
    completed
      .filter((r) => r.startedAt)
      .map((r) => r.startedAt!.toISOString().slice(0, 10))
  );
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (daySet.has(d.toISOString().slice(0, 10))) {
      streak++;
    } else {
      break;
    }
  }

  const todayStr = today.toISOString().slice(0, 10);
  const todaySessions = completed.filter(
    (r) => r.startedAt?.toISOString().slice(0, 10) === todayStr
  );
  const todayMinutes = todaySessions.reduce((s, r) => s + (r.totalFocusedMinutes ?? 0), 0);

  const activeSession = rows.find((r) => !r.endedAt);

  const todayPages = todaySessions.reduce((s, r) => s + (r.pagesVisited ?? 0), 0);

  return NextResponse.json({
    isAdmin: await isAdmin(session.user.email ?? ""),
    totalSessions: completed.length,
    totalMinutes,
    totalPages,
    averageMinutes: completed.length > 0 ? Math.round(totalMinutes / completed.length) : 0,
    pagesPerHour: totalMinutes > 0 ? Math.round((totalPages / totalMinutes) * 60) : 0,
    todayPages,
    streak,
    weekDays,
    todayMinutes,
    todaySessions: todaySessions.length,
    dailyMinutesGoal: user?.dailyMinutesGoal ?? null,
    dailySessionsGoal: user?.dailySessionsGoal ?? null,
    inactivityTimeout: user?.inactivityTimeout ?? null,
    activeSession: activeSession
      ? {
          id: activeSession.id,
          goalType: activeSession.goalType,
          targetValue: activeSession.targetValue,
          startedAt: activeSession.startedAt?.toISOString() ?? null,
          totalFocusedMinutes: activeSession.totalFocusedMinutes ?? 0,
          lastPageIndex: activeSession.lastPageIndex ?? null,
          documentJson: activeSession.documentJson ?? null,
        }
      : null,
    recentSessions: rows
      .sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0))
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        goalType: r.goalType,
        targetValue: r.targetValue,
        startedAt: r.startedAt?.toISOString() ?? null,
        endedAt: r.endedAt?.toISOString() ?? null,
        totalFocusedMinutes: r.totalFocusedMinutes,
        pagesVisited: r.pagesVisited ?? 0,
        documentJson: r.documentJson ?? null,
      })),
  });

  } catch (e) {
    return NextResponse.json(
      { error: "Internal error", detail: (e as Error).message },
      { status: 500 }
    );
  }
}
