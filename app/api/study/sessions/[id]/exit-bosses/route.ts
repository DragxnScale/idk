import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { pageVisits, studySessions } from "@/lib/db/schema";
import { bossForIndex, EXIT_BOSS_COUNT } from "@/lib/exit-bosses";
import {
  generateExitPhrase,
  signBossToken,
  signPhraseToken,
} from "@/lib/exit-phrase-challenge";
import {
  documentIdFromDocJson,
  parseVisitedPagesList,
  queryMcQuestionsForPages,
  shuffleInPlace,
  sourceKeyFromDocJson,
} from "@/lib/velocity-bank";

async function sessionOwnedByUser(sessionId: string, userId: string) {
  const row = await db.query.studySessions.findFirst({
    where: (s, { and: a, eq: e }) => a(e(s.id, sessionId), e(s.userId, userId)),
    columns: { id: true },
  });
  return !!row;
}

async function visitedPagesForSession(sessionId: string, visitedPagesList: string | null) {
  let pages = parseVisitedPagesList(visitedPagesList ?? undefined);
  if (pages.length === 0) {
    const visits = await db.query.pageVisits.findMany({
      where: eq(pageVisits.sessionId, sessionId),
      columns: { pageNumber: true },
    });
    pages = Array.from(new Set(visits.map((v) => v.pageNumber).filter((n) => n > 0)));
  }
  return pages;
}

function shuffleMcOptions<T extends { options: [string, string, string, string]; correctIndex: 0 | 1 | 2 | 3 }>(
  pick: T
): T & { options: [string, string, string, string]; correctIndex: 0 | 1 | 2 | 3 } {
  const indices = [0, 1, 2, 3];
  shuffleInPlace(indices);
  const shuffled = indices.map((i) => pick.options[i]) as [string, string, string, string];
  const newCorrect = indices.indexOf(pick.correctIndex) as 0 | 1 | 2 | 3;
  return { ...pick, options: shuffled, correctIndex: newCorrect };
}

export async function GET(
  _request: Request,
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

  const session = await db.query.studySessions.findFirst({
    where: (s, { eq: e }) => e(s.id, sessionId),
    columns: { documentJson: true, visitedPagesList: true },
  });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const pages = await visitedPagesForSession(sessionId, session.visitedPagesList);
  const sourceKey = sourceKeyFromDocJson(session.documentJson);
  const documentId = documentIdFromDocJson(session.documentJson);

  const picks = await queryMcQuestionsForPages({
    sourceKey,
    documentId,
    pageIndexes: pages,
    limit: EXIT_BOSS_COUNT,
  });

  const phrase = generateExitPhrase();
  const phraseChallenge = {
    token: signPhraseToken({ sessionId, phrase }),
    phrase,
    hint: "Type the phrase exactly to unlock the exit",
  };

  const bosses = picks.map((pick, i) => {
    const shuffled = shuffleMcOptions(pick);
    const persona = bossForIndex(i);
    return {
      bossId: signBossToken({
        sessionId,
        bankRowId: pick.bankRowId,
        correctIndex: shuffled.correctIndex,
        explanation: pick.explanation,
      }),
      bossKey: persona.key,
      name: persona.name,
      taunt: persona.taunt,
      emoji: persona.emoji,
      colorClass: persona.colorClass,
      question: shuffled.question,
      options: shuffled.options,
    };
  });

  return NextResponse.json({ bosses, phraseChallenge });
}
