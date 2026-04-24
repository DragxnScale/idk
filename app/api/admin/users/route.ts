import { NextResponse } from "next/server";
import { requireAdmin, isSuperAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { users as usersTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getDefaultAiTokenLimit } from "@/lib/ai-usage";

const SUPER_ADMIN_EMAIL = "jaydenw0711@gmail.com";

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allUsers = await db.query.users.findMany();
  const allSessions = await db.query.studySessions.findMany();
  const defaultLimit = getDefaultAiTokenLimit();

  const users = allUsers.map((u) => {
    const userSessions = allSessions.filter((s) => s.userId === u.id);
    const completed = userSessions.filter((s) => s.endedAt);
    const active = userSessions.find((s) => !s.endedAt);
    const lastSession = userSessions
      .sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0))[0];

    // Effective limit the user is actually being capped at right now.
    // Null means unlimited (neither user override nor deploy-level default
    // is set). Super admin (owner) is always unlimited.
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
      sessionCount: completed.length,
      totalMinutes: completed.reduce((s, r) => s + (r.totalFocusedMinutes ?? 0), 0),
      lastActiveAt: lastSession?.startedAt?.toISOString() ?? null,
      hasActiveSession: !!active,
      aiTokensUsed: u.aiTokensUsed ?? 0,
      aiTokenLimit: explicit,
      aiTokenLimitEffective: effectiveLimit,
    };
  });

  users.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return NextResponse.json(users);
}

export async function PATCH(request: Request) {
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
