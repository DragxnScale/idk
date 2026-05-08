import { NextResponse } from "next/server";
import { requireAdmin, isSuperAdmin, requireSameOrigin } from "@/lib/admin";
import { db } from "@/lib/db";
import { users as usersTable, studySessions as sessionsTable } from "@/lib/db/schema";
import { eq, sql, isNotNull, isNull } from "drizzle-orm";
import { getDefaultAiTokenLimit } from "@/lib/ai-usage";

const SUPER_ADMIN_EMAIL = "jaydenw0711@gmail.com";

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Aggregate session stats per-user in SQL (one query each) instead of
  // pulling every row from study_sessions and aggregating in JS. At
  // ~1k users with ~50 sessions each, the old findMany approach moved
  // 50k rows over the wire on every admin page load.
  const [allUsers, completedAgg, activeAgg, lastActiveAgg] = await Promise.all([
    db.query.users.findMany(),
    db
      .select({
        userId: sessionsTable.userId,
        sessionCount: sql<number>`count(*)`.as("session_count"),
        totalMinutes: sql<number>`coalesce(sum(${sessionsTable.totalFocusedMinutes}), 0)`.as("total_minutes"),
      })
      .from(sessionsTable)
      .where(isNotNull(sessionsTable.endedAt))
      .groupBy(sessionsTable.userId),
    db
      .select({ userId: sessionsTable.userId })
      .from(sessionsTable)
      .where(isNull(sessionsTable.endedAt))
      .groupBy(sessionsTable.userId),
    db
      .select({
        userId: sessionsTable.userId,
        lastStartedAt: sql<number | null>`max(${sessionsTable.startedAt})`.as("last_started_at"),
      })
      .from(sessionsTable)
      .groupBy(sessionsTable.userId),
  ]);

  const completedByUser = new Map(
    completedAgg.map((r) => [r.userId, { count: Number(r.sessionCount ?? 0), minutes: Number(r.totalMinutes ?? 0) }])
  );
  const activeUserIds = new Set(activeAgg.map((r) => r.userId));
  const lastActiveByUser = new Map(
    lastActiveAgg.map((r) => {
      const raw = r.lastStartedAt;
      if (raw == null) return [r.userId, null] as const;
      // Drizzle returns timestamp-mode integers as ms-since-epoch numbers.
      const d = new Date(typeof raw === "number" ? raw * 1000 : raw);
      return [r.userId, isNaN(d.getTime()) ? null : d.toISOString()] as const;
    })
  );

  const defaultLimit = getDefaultAiTokenLimit();

  const users = allUsers.map((u) => {
    const completed = completedByUser.get(u.id) ?? { count: 0, minutes: 0 };

    const explicit = typeof u.aiTokenLimit === "number" && u.aiTokenLimit > 0 ? u.aiTokenLimit : null;
    const isSuperAdminUser = u.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
    const effectiveLimit = isSuperAdminUser ? null : explicit ?? defaultLimit;

    return {
      id: u.id,
      email: u.email,
      name: u.name ?? null,
      isAdmin: u.isAdmin === true || isSuperAdminUser,
      isSuperAdmin: isSuperAdminUser,
      createdAt: u.createdAt?.toISOString() ?? null,
      sessionCount: completed.count,
      totalMinutes: completed.minutes,
      lastActiveAt: lastActiveByUser.get(u.id) ?? null,
      hasActiveSession: activeUserIds.has(u.id),
      aiTokensUsed: u.aiTokensUsed ?? 0,
      aiTokenLimit: explicit,
      aiTokenLimitEffective: effectiveLimit,
    };
  });

  users.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return NextResponse.json(users);
}

export async function PATCH(request: Request) {
  if (!requireSameOrigin()) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  const session = await requireAdmin();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isSuperAdmin(session.user.email)) {
    return NextResponse.json({ error: "Only the super admin can manage admin roles" }, { status: 403 });
  }

  const body = await request.json();
  const { userId, isAdmin } = body;
  if (!userId || typeof isAdmin !== "boolean") {
    return NextResponse.json({ error: "userId and isAdmin required" }, { status: 400 });
  }

  const target = await db.query.users.findFirst({
    where: eq(usersTable.id, userId),
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (target.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
    return NextResponse.json({ error: "Cannot modify super admin" }, { status: 400 });
  }

  await db.update(usersTable).set({ isAdmin }).where(eq(usersTable.id, userId));

  return NextResponse.json({ ok: true });
}
