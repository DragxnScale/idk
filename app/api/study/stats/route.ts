import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.query.studySessions.findMany({
    where: (s, { eq }) => eq(s.userId, session.user.id),
  });

  const completed = rows.filter((r) => r.endedAt);
  const totalMinutes = completed.reduce(
    (sum, r) => sum + (r.totalFocusedMinutes ?? 0),
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

  return NextResponse.json({
    totalSessions: completed.length,
    totalMinutes,
    averageMinutes: completed.length > 0 ? Math.round(totalMinutes / completed.length) : 0,
    streak,
    weekDays,
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
      })),
  });
}
