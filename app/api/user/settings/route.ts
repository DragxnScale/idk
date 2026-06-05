import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/password";

export async function GET() {
  const authUser = await getAppUser();
  if (!authUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, authUser.id),
  });

  if (!row) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    name: row.name ?? null,
    email: row.email ?? null,
    dailyMinutesGoal: row.dailyMinutesGoal ?? null,
    dailySessionsGoal: row.dailySessionsGoal ?? null,
    inactivityTimeout: row.inactivityTimeout ?? null,
    themeId: row.themeId ?? null,
    quizMinQuestions: row.quizMinQuestions ?? null,
    quizMaxQuestions: row.quizMaxQuestions ?? null,
    defaultGoalType: row.defaultGoalType ?? null,
    defaultTargetValue: row.defaultTargetValue ?? null,
    pomodoroEnabled: row.pomodoroEnabled ?? false,
    pomodoroFocusMin: row.pomodoroFocusMin ?? null,
    pomodoroBreakMin: row.pomodoroBreakMin ?? null,
    pomodoroLongBreakMin: row.pomodoroLongBreakMin ?? null,
    pomodoroCycles: row.pomodoroCycles ?? null,
    /** Spaced-repetition pacing caps (Anki-style). null = use defaults. */
    srsNewPerDay: row.srsNewPerDay ?? null,
    srsReviewsPerDay: row.srsReviewsPerDay ?? null,
  });
}

export async function PATCH(request: Request) {
  const authUser = await getAppUser();
  if (!authUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    currentPassword,
    newExitPassword,
    currentLoginPassword,
    newLoginPassword,
    confirmLoginPassword,
    dailyMinutesGoal,
    dailySessionsGoal,
    inactivityTimeout,
    themeId,
    quizMinQuestions,
    quizMaxQuestions,
    defaultGoalType,
    defaultTargetValue,
    name,
    pomodoroEnabled,
    pomodoroFocusMin,
    pomodoroBreakMin,
    pomodoroLongBreakMin,
    pomodoroCycles,
    srsNewPerDay,
    srsReviewsPerDay,
  } = body;

  const row = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.id, authUser.id),
  });
  if (!row) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // ── Login password change ─────────────────────────────────────────
  if (currentLoginPassword !== undefined && newLoginPassword !== undefined) {
    if (typeof newLoginPassword !== "string" || newLoginPassword.length < 6) {
      return NextResponse.json(
        { error: "New login password must be at least 6 characters" },
        { status: 400 }
      );
    }
    if (typeof confirmLoginPassword !== "string" || confirmLoginPassword !== newLoginPassword) {
      return NextResponse.json({ error: "New login passwords do not match" }, { status: 400 });
    }
    if (!row.passwordHash) {
      return NextResponse.json({ error: "No login password set for this account" }, { status: 400 });
    }
    const valid = await verifyPassword(String(currentLoginPassword), row.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Incorrect current password" }, { status: 401 });
    }
    const passwordHash = await hashPassword(newLoginPassword);
    await db.update(users).set({ passwordHash }).where(eq(users.id, authUser.id));
    return NextResponse.json({ ok: true });
  }

  // ── Exit password change ──────────────────────────────────────────
  if (currentPassword !== undefined && newExitPassword !== undefined) {
    if (newExitPassword.length < 4) {
      return NextResponse.json(
        { error: "Exit password must be at least 4 characters" },
        { status: 400 }
      );
    }
    if (!row.passwordHash) {
      return NextResponse.json({ error: "No login password set" }, { status: 400 });
    }
    const valid = await verifyPassword(currentPassword, row.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Incorrect login password" }, { status: 401 });
    }
    const exitPasswordHash = await hashPassword(newExitPassword);
    await db.update(users).set({ exitPasswordHash }).where(eq(users.id, authUser.id));
    return NextResponse.json({ ok: true });
  }

  // ── Daily goals / settings update ────────────────────────────────
  if (themeId !== undefined) {
    await db.update(users).set({ themeId: themeId || null }).where(eq(users.id, authUser.id));
    return NextResponse.json({ ok: true });
  }

  // The user-facing "Developer mode" toggle was removed on 2026-06.
  // Admins now implicitly have dev-mode-on at every consumption site
  // (see `isCurrentDeveloper()` in `lib/app-user.ts`). The DB column
  // `users.is_developer` is retained for backwards compat but writes
  // from this endpoint are no longer accepted — stale clients that
  // still POST `isDeveloper` get silently ignored.

  if (dailyMinutesGoal !== undefined || dailySessionsGoal !== undefined || inactivityTimeout !== undefined || quizMinQuestions !== undefined || quizMaxQuestions !== undefined || defaultGoalType !== undefined || defaultTargetValue !== undefined || name !== undefined || pomodoroEnabled !== undefined || pomodoroFocusMin !== undefined || pomodoroBreakMin !== undefined || pomodoroLongBreakMin !== undefined || pomodoroCycles !== undefined || srsNewPerDay !== undefined || srsReviewsPerDay !== undefined) {
    const update: Partial<typeof users.$inferInsert> = {};

    if (name !== undefined) {
      update.name = typeof name === "string" && name.trim() ? name.trim().slice(0, 64) : null;
    }
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
    if (defaultGoalType !== undefined) {
      const valid = ["time", "pages", "chapter"];
      update.defaultGoalType = valid.includes(defaultGoalType) ? defaultGoalType : null;
    }
    if (defaultTargetValue !== undefined) {
      const v = Math.round(Number(defaultTargetValue));
      update.defaultTargetValue = v > 0 ? v : null;
    }
    if (pomodoroEnabled !== undefined) {
      update.pomodoroEnabled = !!pomodoroEnabled;
    }
    if (pomodoroFocusMin !== undefined) {
      const v = Math.round(Number(pomodoroFocusMin));
      update.pomodoroFocusMin = v >= 1 && v <= 90 ? v : null;
    }
    if (pomodoroBreakMin !== undefined) {
      const v = Math.round(Number(pomodoroBreakMin));
      update.pomodoroBreakMin = v >= 1 && v <= 30 ? v : null;
    }
    if (pomodoroLongBreakMin !== undefined) {
      const v = Math.round(Number(pomodoroLongBreakMin));
      update.pomodoroLongBreakMin = v >= 1 && v <= 60 ? v : null;
    }
    if (pomodoroCycles !== undefined) {
      const v = Math.round(Number(pomodoroCycles));
      update.pomodoroCycles = v >= 1 && v <= 10 ? v : null;
    }
    if (srsNewPerDay !== undefined) {
      // Range 0–500. 0 = pause new card introduction (study existing
      // schedule only). >500 is the soft sanity ceiling — anyone
      // actually wanting more than 500 new cards a day should be
      // running their own Anki and we'll consider raising the cap
      // when someone asks.
      const v = Math.round(Number(srsNewPerDay));
      update.srsNewPerDay = Number.isFinite(v) && v >= 0 && v <= 500 ? v : null;
    }
    if (srsReviewsPerDay !== undefined) {
      const v = Math.round(Number(srsReviewsPerDay));
      update.srsReviewsPerDay = Number.isFinite(v) && v >= 1 && v <= 9999 ? v : null;
    }

    await db.update(users).set(update).where(eq(users.id, authUser.id));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
}
