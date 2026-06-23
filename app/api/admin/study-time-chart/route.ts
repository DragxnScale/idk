import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import {
  users as usersTable,
  studySessions as sessionsTable,
} from "@/lib/db/schema";
import { eq, sql, isNotNull, gte, and } from "drizzle-orm";

export async function GET(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(Number(searchParams.get("days")) || 30, 1), 90);

  // Build date range: today (UTC midnight) going back `days` days
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);
  const cutoff = new Date(todayUTC.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  const dayExpr = sql<string>`strftime('%Y-%m-%d', datetime(${sessionsTable.startedAt}, 'unixepoch'))`;

  const rows = await db
    .select({
      userId: sessionsTable.userId,
      userName: usersTable.name,
      day: dayExpr.as("day"),
      minutes: sql<number>`coalesce(sum(${sessionsTable.totalFocusedMinutes}), 0)`.as(
        "minutes"
      ),
    })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(
      and(
        isNotNull(sessionsTable.endedAt),
        gte(sessionsTable.startedAt, cutoff)
      )
    )
    .groupBy(
      sessionsTable.userId,
      sql`strftime('%Y-%m-%d', datetime(${sessionsTable.startedAt}, 'unixepoch'))`
    )
    .orderBy(
      sql`strftime('%Y-%m-%d', datetime(${sessionsTable.startedAt}, 'unixepoch'))`
    );

  // Pre-populate all days with zeros
  const dayMap = new Map<
    string,
    { totalMinutes: number; byUser: Map<string, { name: string; minutes: number }> }
  >();
  for (let i = 0; i < days; i++) {
    const d = new Date(cutoff.getTime() + i * 24 * 60 * 60 * 1000);
    dayMap.set(d.toISOString().slice(0, 10), {
      totalMinutes: 0,
      byUser: new Map(),
    });
  }

  for (const row of rows) {
    const entry = dayMap.get(row.day);
    if (!entry) continue;
    const mins = Number(row.minutes);
    entry.totalMinutes += mins;
    const prev = entry.byUser.get(row.userId);
    entry.byUser.set(row.userId, {
      name: row.userName ?? row.userId,
      minutes: (prev?.minutes ?? 0) + mins,
    });
  }

  const result = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      totalMinutes: data.totalMinutes,
      byUser: Array.from(data.byUser.entries()).map(([userId, u]) => ({
        userId,
        name: u.name,
        minutes: u.minutes,
      })),
    }));

  return NextResponse.json({ days: result });
}
