/**
 * GET /api/user/ai-usage
 *
 * Returns the signed-in user's lifetime AI token usage and effective
 * limit so the dashboard can show "you've used X of Y tokens" without
 * exposing it as an admin-only stat. Same numbers admins see in the
 * Users table — just scoped to the caller.
 */
import { NextResponse } from "next/server";
import { sql, desc } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { aiUsageLogs } from "@/lib/db/schema";
import { getAiTokenStatus } from "@/lib/ai-usage";

export async function GET() {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getAiTokenStatus(user.id);
  if (!status) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Per-route breakdown for the last 30 days, so the user can see
  // where their tokens are going (notes vs quizzes vs velocity).
  // Capped at 8 routes — no AI route has more than that anyway.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const breakdown = await db
    .select({
      route: aiUsageLogs.route,
      tokens: sql<number>`COALESCE(SUM(${aiUsageLogs.totalTokens}), 0)`.as("tokens"),
      calls: sql<number>`COUNT(*)`.as("calls"),
    })
    .from(aiUsageLogs)
    .where(sql`${aiUsageLogs.userId} = ${user.id} AND ${aiUsageLogs.createdAt} >= ${thirtyDaysAgo}`)
    .groupBy(aiUsageLogs.route)
    .orderBy(desc(sql`tokens`))
    .limit(10);

  // Compute % of effective limit. null limit = unlimited; we still
  // surface the raw used count so the user has a sense of consumption.
  const pct =
    status.limit != null && status.limit > 0
      ? Math.min(100, Math.round((status.used / status.limit) * 100))
      : null;

  return NextResponse.json({
    used: status.used,
    limit: status.limit,
    remaining: status.remaining,
    overBudget: status.overBudget,
    pct,
    /** True when no cap is enforced (user limit is null AND default is 0). */
    unlimited: status.limit == null,
    breakdown: breakdown.map((b) => ({
      route: b.route,
      tokens: Number(b.tokens ?? 0),
      calls: Number(b.calls ?? 0),
    })),
  });
}

// Avoid stale data — usage updates immediately after every AI call.
export const dynamic = "force-dynamic";
