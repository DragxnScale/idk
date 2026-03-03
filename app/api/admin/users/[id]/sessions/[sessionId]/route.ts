import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { studySessions, pageVisits } from "@/lib/db/schema";

export async function GET(
  _request: Request,
  { params }: { params: { id: string; sessionId: string } }
) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await db.query.studySessions.findFirst({
    where: (s, { eq: e, and: a }) =>
      a(e(s.id, params.sessionId), e(s.userId, params.id)),
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const visits = await db
    .select()
    .from(pageVisits)
    .where(eq(pageVisits.sessionId, params.sessionId));

  visits.sort(
    (a, b) => (a.enteredAt?.getTime() ?? 0) - (b.enteredAt?.getTime() ?? 0)
  );

  let docInfo: { title?: string; chapterPageRanges?: Record<string, [number, number]>; selectedChapters?: string[] } = {};
  if (session.documentJson) {
    try {
      const parsed = JSON.parse(session.documentJson);
      docInfo = {
        title: parsed.title ?? parsed.catalogTitle ?? undefined,
        chapterPageRanges: parsed.chapterPageRanges ?? undefined,
        selectedChapters: parsed.selectedChapters ?? undefined,
      };
    } catch {}
  }

  return NextResponse.json({
    session: {
      id: session.id,
      goalType: session.goalType,
      targetValue: session.targetValue,
      startedAt: session.startedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
      totalFocusedMinutes: session.totalFocusedMinutes ?? 0,
      pagesVisited: session.pagesVisited ?? 0,
      lastPageIndex: session.lastPageIndex ?? null,
    },
    document: docInfo,
    pageVisits: visits.map((v) => ({
      id: v.id,
      pageNumber: v.pageNumber,
      enteredAt: v.enteredAt?.toISOString() ?? null,
      leftAt: v.leftAt?.toISOString() ?? null,
      durationSeconds: v.durationSeconds ?? null,
    })),
  });
}
