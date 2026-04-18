import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/password";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, session.user.id),
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    dailyMinutesGoal: user.dailyMinutesGoal ?? null,
    dailySessionsGoal: user.dailySessionsGoal ?? null,
    inactivityTimeout: user.inactivityTimeout ?? null,
    themeId: user.themeId ?? null,
    quizMinQuestions: user.quizMinQuestions ?? null,
    quizMaxQuestions: user.quizMaxQuestions ?? null,
  });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { currentPassword, newExitPassword, dailyMinutesGoal, dailySessionsGoal, inactivityTimeout, themeId, quizMinQuestions, quizMaxQuestions } = body;

  const user = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, session.user.id),
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // ── Exit password change ──────────────────────────────────────────
  if (currentPassword !== undefined && newExitPassword !== undefined) {
    if (newExitPassword.length < 4) {
      return NextResponse.json(
        { error: "Exit password must be at least 4 characters" },
        { status: 400 }
      );
    }
    if (!user.passwordHash) {
      return NextResponse.json({ error: "No login password set" }, { status: 400 });
    }
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Incorrect login password" }, { status: 401 });
    }
    const exitPasswordHash = await hashPassword(newExitPassword);
    await db.update(users).set({ exitPasswordHash }).where(eq(users.id, session.user.id));
    return NextResponse.json({ ok: true });
  }

  // ── Daily goals / settings update ────────────────────────────────
  if (themeId !== undefined) {
    await db.update(users).set({ themeId: themeId || null }).where(eq(users.id, session.user.id));
    return NextResponse.json({ ok: true });
  }

  if (dailyMinutesGoal !== undefined || dailySessionsGoal !== undefined || inactivityTimeout !== undefined || quizMinQuestions !== undefined || quizMaxQuestions !== undefined) {
    const update: Partial<typeof users.$inferInsert> = {};

    if (dailyMinutesGoal !== undefined) {
      const v = Number(dailyMinutesGoal);
      update.dailyMinutesGoal = v > 0 ? v : null;
    }
    if (dailySessionsGoal !== undefined) {
      const v = Number(dailySessionsGoal);
      update.dailySessionsGoal = v > 0 ? v : null;
    }
    if (inactivityTimeout !== undefined) {
      const v = Number(inactivityTimeout);
      update.inactivityTimeout = v > 0 ? v : null;
    }
    if (quizMinQuestions !== undefined) {
      const v = Math.round(Number(quizMinQuestions));
      update.quizMinQuestions = v >= 1 && v <= 25 ? v : null;
    }
    if (quizMaxQuestions !== undefined) {
      const v = Math.round(Number(quizMaxQuestions));
      update.quizMaxQuestions = v >= 1 && v <= 25 ? v : null;
    }

    await db.update(users).set(update).where(eq(users.id, session.user.id));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
}
