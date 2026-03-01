import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allUsers = await db.query.users.findMany();
  const allSessions = await db.query.studySessions.findMany();

  const users = allUsers.map((u) => {
    const userSessions = allSessions.filter((s) => s.userId === u.id);
    const completed = userSessions.filter((s) => s.endedAt);
    const active = userSessions.find((s) => !s.endedAt);
    const lastSession = userSessions
      .sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0))[0];

    return {
      id: u.id,
      email: u.email,
      name: u.name ?? null,
      createdAt: u.createdAt?.toISOString() ?? null,
      sessionCount: completed.length,
      totalMinutes: completed.reduce((s, r) => s + (r.totalFocusedMinutes ?? 0), 0),
      lastActiveAt: lastSession?.startedAt?.toISOString() ?? null,
      hasActiveSession: !!active,
    };
  });

  users.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return NextResponse.json(users);
}
