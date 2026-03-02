import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.query.bookmarks.findMany({
    where: (b, { eq: e }) => e(b.userId, session.user.id),
    orderBy: (b, { desc: d }) => d(b.createdAt),
  });

  const sessionIds = Array.from(new Set(rows.map((r) => r.sessionId).filter(Boolean)));
  const sessionRows =
    sessionIds.length > 0
      ? await Promise.all(
          sessionIds.map((sid) =>
            db.query.studySessions.findFirst({
              where: (s, { eq: e }) => e(s.id, sid!),
            })
          )
        )
      : [];

  const sessionMap = new Map(
    sessionRows
      .filter(Boolean)
      .map((s) => [
        s!.id,
        {
          startedAt: s!.startedAt?.toISOString() ?? null,
          documentJson: s!.documentJson,
        },
      ])
  );

  const enriched = rows.map((r) => {
    const sess = r.sessionId ? sessionMap.get(r.sessionId) : null;
    let docTitle: string | null = null;
    if (sess?.documentJson) {
      try {
        docTitle = JSON.parse(sess.documentJson).title ?? null;
      } catch {}
    }
    return {
      ...r,
      createdAt: r.createdAt?.toISOString() ?? null,
      sessionDate: sess?.startedAt ?? null,
      docTitle,
    };
  });

  return NextResponse.json(enriched);
}
