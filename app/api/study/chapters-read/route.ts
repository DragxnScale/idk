import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.query.studySessions.findMany({
    where: (s, { and, eq, isNotNull }) =>
      and(eq(s.userId, session.user.id), isNotNull(s.endedAt)),
  });

  const read: Record<string, string[]> = {};

  for (const row of rows) {
    if (!row.documentJson) continue;
    try {
      const doc = JSON.parse(row.documentJson);
      if (doc.type !== "textbook" || !doc.documentId) continue;

      const chMatch = doc.title?.match(/Ch\.\s*(\d+)/);
      if (!chMatch) continue;

      const bookId = doc.documentId as string;
      const chapter = chMatch[1];
      if (!read[bookId]) read[bookId] = [];
      if (!read[bookId].includes(chapter)) read[bookId].push(chapter);
    } catch {
      continue;
    }
  }

  return NextResponse.json(read);
}
