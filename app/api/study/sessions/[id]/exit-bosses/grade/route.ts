import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { verifyBossToken } from "@/lib/exit-phrase-challenge";

async function sessionOwnedByUser(sessionId: string, userId: string) {
  const row = await db.query.studySessions.findFirst({
    where: (s, { and: a, eq: e }) => a(e(s.id, sessionId), e(s.userId, userId)),
    columns: { id: true },
  });
  return !!row;
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = params.id;
  if (!(await sessionOwnedByUser(sessionId, user.id))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const body = await request.json() as {
    bossId?: string;
    selectedIndex?: number;
  };

  const { bossId, selectedIndex } = body;
  if (!bossId || typeof selectedIndex !== "number" || selectedIndex < 0 || selectedIndex > 3) {
    return NextResponse.json({ error: "bossId and selectedIndex (0-3) required" }, { status: 400 });
  }

  const payload = verifyBossToken(bossId, sessionId);
  if (!payload) {
    return NextResponse.json({ error: "Invalid or expired boss token" }, { status: 400 });
  }

  const correct = selectedIndex === payload.correctIndex;
  if (correct) {
    return NextResponse.json({
      correct: true,
      defeated: true,
      explanation: payload.explanation ?? undefined,
    });
  }

  return NextResponse.json({
    correct: false,
    defeated: false,
    explanation: payload.explanation ?? undefined,
  });
}
