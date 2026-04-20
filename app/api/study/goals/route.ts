import { NextResponse } from "next/server";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { studyGoals, studySessions } from "@/lib/db/schema";

/** GET: active multi-session goals for the user with progress (completed sessions only). */
export async function GET() {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const goals = await db.query.studyGoals.findMany({
    where: (g, { eq: e, and: a }) =>
      a(e(g.userId, user.id), e(g.status, "active")),
  });

  const rows = await Promise.all(
    goals.map(async (g) => {
      const [agg] = await db
        .select({
          total: sql<number>`coalesce(sum(${studySessions.totalFocusedMinutes}), 0)`,
        })
        .from(studySessions)
        .where(
          and(
            eq(studySessions.studyGoalId, g.id),
            isNotNull(studySessions.endedAt)
          )
        );
      const completedMinutes = Number(agg?.total ?? 0);
      return {
        id: g.id,
        goalType: g.goalType,
        targetValue: g.targetValue,
        documentJson: g.documentJson ?? null,
        status: g.status,
        completedMinutes,
        createdAt: g.createdAt?.toISOString() ?? null,
      };
    })
  );

  return NextResponse.json(rows);
}
