import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { verifyPhraseToken } from "@/lib/exit-phrase-challenge";

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

  const body = await request.json() as { token?: string; phrase?: string };
  const { token, phrase } = body;
  if (!token || typeof phrase !== "string") {
    return NextResponse.json({ error: "token and phrase required" }, { status: 400 });
  }

  const ok = verifyPhraseToken(token, sessionId, phrase);
  if (!ok) {
    return NextResponse.json({ error: "Incorrect phrase" }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
