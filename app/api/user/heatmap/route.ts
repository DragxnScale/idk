import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";

export async function GET() {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.query.studySessions.findMany({
    where: (s, { and, eq, isNotNull }) =>
      and(eq(s.userId, user.id), isNotNull(s.endedAt)),
  });

  // Build a map of date → total minutes for the past 365 days
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(today);
  start.setDate(start.getDate() - 364);

  const minutesByDay: Record<string, number> = {};

  for (const row of rows) {
    if (!row.startedAt) continue;
    const dayStr = row.startedAt.toISOString().slice(0, 10);
    const dayDate = new Date(dayStr);
    if (dayDate < start) continue;
    minutesByDay[dayStr] = (minutesByDay[dayStr] ?? 0) + (row.totalFocusedMinutes ?? 0);
  }

  // Return all 365 days (including zeros) so the client can render full grid
  const days: { date: string; minutes: number }[] = [];
  for (let i = 0; i < 365; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dayStr = d.toISOString().slice(0, 10);
    days.push({ date: dayStr, minutes: minutesByDay[dayStr] ?? 0 });
  }

  return NextResponse.json({ days });
}
