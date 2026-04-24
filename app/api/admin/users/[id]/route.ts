import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAdmin, isAdmin, isSuperAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { users, studySessions, pageVisits, bannedEmails } from "@/lib/db/schema";

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
      inactivityTimeout: target.inactivityTimeout ?? null,
      storageBytes: target.storageBytes ?? 0,
      storageQuotaBytes: target.storageQuotaBytes ?? null,
      aiTokensUsed: target.aiTokensUsed ?? 0,
      aiTokenLimit: target.aiTokenLimit ?? null,
    },
    sessions: sessions.map((s) => ({
      id: s.id,
      goalType: s.goalType,
      targetValue: s.targetValue,
      startedAt: s.startedAt?.toISOString() ?? null,
      endedAt: s.endedAt?.toISOString() ?? null,
      totalFocusedMinutes: s.totalFocusedMinutes ?? 0,
      lastPageIndex: s.lastPageIndex ?? null,
      pagesVisited: s.pagesVisited ?? 0,
      documentJson: s.documentJson ?? null,
    })),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if (typeof body.inactivityTimeout === "number") {
    updates.inactivityTimeout = body.inactivityTimeout > 0 ? body.inactivityTimeout : null;
  } else if (body.inactivityTimeout === null) {
    updates.inactivityTimeout = null;
  }

  // Storage quota override (null = reset to default)
  if ("storageQuotaBytes" in body) {
    updates.storageQuotaBytes =
      typeof body.storageQuotaBytes === "number" && body.storageQuotaBytes > 0
        ? body.storageQuotaBytes
        : null;
  }

  // Per-user AI token budget cap. null = fall back to DEFAULT_AI_TOKEN_LIMIT
  // from lib/ai-usage.ts (or `AI_TOKEN_LIMIT_DEFAULT` env var).
  if ("aiTokenLimit" in body) {
    updates.aiTokenLimit =
      typeof body.aiTokenLimit === "number" && body.aiTokenLimit > 0
        ? body.aiTokenLimit
        : null;
  }

  // Reset the lifetime AI token counter back to zero. Useful for
  // "fresh start" / monthly billing-style resets.
  if (body.resetAiTokens === true) {
    updates.aiTokensUsed = 0;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  await db.update(users).set(updates).where(eq(users.id, params.id));
  return NextResponse.json({ ok: true });
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

  if (isSuperAdmin(target.email)) {
    return NextResponse.json({ error: "Cannot ban the owner account" }, { status: 400 });
  }

  if (await isAdmin(target.email)) {
    return NextResponse.json({ error: "Cannot ban an admin. Remove admin role first." }, { status: 400 });
  }

  const adminSession = await requireAdmin();
  const { searchParams: sp } = new URL(request.url);
  const blacklist = sp.get("blacklist") !== "false";
  const reason = sp.get("reason") || null;

  if (blacklist) {
    await db.insert(bannedEmails).values({
      email: target.email.toLowerCase(),
      reason,
      bannedBy: adminSession?.user?.email ?? "unknown",
      bannedAt: new Date(),
    }).onConflictDoNothing();
  }

  await db.delete(users).where(eq(users.id, params.id));

  return NextResponse.json({ ok: true });
}
