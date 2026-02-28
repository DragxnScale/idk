import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = store.getSessionsByUser(session.user.id);

  rows.sort(
    (a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  return NextResponse.json(rows.slice(0, 50));
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const goalType = body.goalType as string;
  const targetValue = body.targetValue as number;

  if (!goalType || targetValue == null) {
    return NextResponse.json(
      { error: "goalType and targetValue are required" },
      { status: 400 }
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  store.createSession({
    id,
    userId: session.user.id,
    goalType,
    targetValue,
    startedAt: now,
    endedAt: null,
    totalFocusedMinutes: null,
    lastPageIndex: null,
    createdAt: now,
  });

  return NextResponse.json({ id, goalType, targetValue, startedAt: now });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const sessionId = body.sessionId as string;
  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 }
    );
  }

  const existing = store.getSession(sessionId, session.user.id);
  if (!existing) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if (body.endedAt != null) updates.endedAt = new Date(body.endedAt).toISOString();
  if (typeof body.totalFocusedMinutes === "number")
    updates.totalFocusedMinutes = body.totalFocusedMinutes;
  if (typeof body.lastPageIndex === "number")
    updates.lastPageIndex = body.lastPageIndex;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(existing);
  }

  store.updateSession(sessionId, updates);

  return NextResponse.json({ ok: true, ...updates });
}
