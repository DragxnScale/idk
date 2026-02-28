import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = store.getSessionsByUser(session.user.id);

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
      return new Date(r.startedAt).toISOString().slice(0, 10) === dayStr;
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
      .map((r) => new Date(r.startedAt).toISOString().slice(0, 10))
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
    averageMinutes:
      completed.length > 0 ? Math.round(totalMinutes / completed.length) : 0,
    streak,
    weekDays,
    recentSessions: rows
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      )
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        goalType: r.goalType,
        targetValue: r.targetValue,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        totalFocusedMinutes: r.totalFocusedMinutes,
      })),
  });
}
