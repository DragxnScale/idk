import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { users, studySessions } from "@/lib/db/schema";
import { isAdminEmail } from "@/lib/admin";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const target = await db.query.users.findFirst({
    where: (u, { eq: e }) => e(u.id, params.id),
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const sessions = await db.query.studySessions.findMany({
    where: (s, { eq: e }) => e(s.userId, params.id),
  });

  sessions.sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0));

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  if (action === "wipe-session") {
    const sid = searchParams.get("sessionId");
    if (!sid) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
    await db.delete(studySessions).where(
      and(eq(studySessions.id, sid), eq(studySessions.userId, params.id))
    );
    return NextResponse.json({ ok: true });
  }

  if (action === "wipe-all-sessions") {
    await db.delete(studySessions).where(eq(studySessions.userId, params.id));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({
    user: {
      id: target.id,
      email: target.email,
      name: target.name ?? null,
      createdAt: target.createdAt?.toISOString() ?? null,
    },
    sessions: sessions.map((s) => ({
      id: s.id,
      goalType: s.goalType,
      targetValue: s.targetValue,
      startedAt: s.startedAt?.toISOString() ?? null,
      endedAt: s.endedAt?.toISOString() ?? null,
      totalFocusedMinutes: s.totalFocusedMinutes ?? 0,
      lastPageIndex: s.lastPageIndex ?? null,
    })),
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  // Delete a specific study session
  if (sessionId) {
    await db.delete(studySessions).where(
      and(eq(studySessions.id, sessionId), eq(studySessions.userId, params.id))
    );
    return NextResponse.json({ ok: true });
  }

  // Delete the user account
  const target = await db.query.users.findFirst({
    where: (u, { eq: e }) => e(u.id, params.id),
  });

  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (isAdminEmail(target.email)) {
    return NextResponse.json({ error: "Cannot ban admin account" }, { status: 400 });
  }

  await db.delete(users).where(eq(users.id, params.id));

  return NextResponse.json({ ok: true });
}
