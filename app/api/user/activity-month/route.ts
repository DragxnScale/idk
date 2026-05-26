import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const yearParam = Number(url.searchParams.get("year"));
  const monthParam = Number(url.searchParams.get("month"));

  const now = new Date();
  const year =
    Number.isFinite(yearParam) && yearParam >= 1970 && yearParam <= 9999
      ? yearParam
      : now.getUTCFullYear();
  const month =
    Number.isFinite(monthParam) && monthParam >= 1 && monthParam <= 12
      ? monthParam
      : now.getUTCMonth() + 1;

  const rows = await db.query.studySessions.findMany({
    where: (s, { and, eq, isNotNull }) =>
      and(eq(s.userId, user.id), isNotNull(s.endedAt)),
  });

  // Collect both the first-ever session date (so the client can disable the
  // back-arrow at the start of history) and per-day totals for the requested
  // month. Date keys are UTC to match the heatmap and stats endpoints.
  let earliestDate: string | null = null;
  const minutesByDay: Record<string, number> = {};
  const sessionsByDay: Record<string, number> = {};

  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;

  for (const row of rows) {
    if (!row.startedAt) continue;
    const dayStr = row.startedAt.toISOString().slice(0, 10);
    if (!earliestDate || dayStr < earliestDate) earliestDate = dayStr;
    if (!dayStr.startsWith(monthPrefix)) continue;
    minutesByDay[dayStr] = (minutesByDay[dayStr] ?? 0) + (row.totalFocusedMinutes ?? 0);
    sessionsByDay[dayStr] = (sessionsByDay[dayStr] ?? 0) + 1;
  }

  // daysInMonth: use Date(year, month, 0) where month is 1-indexed → returns
  // last day of `month`. UTC equivalent is Date.UTC(year, month, 0).
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: { date: string; minutes: number; sessions: number }[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = `${monthPrefix}-${String(d).padStart(2, "0")}`;
    days.push({
      date: dayStr,
      minutes: minutesByDay[dayStr] ?? 0,
      sessions: sessionsByDay[dayStr] ?? 0,
    });
  }

  return NextResponse.json({ year, month, days, earliestDate });
}
