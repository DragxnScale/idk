import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { pageVisits, studySessions } from "@/lib/db/schema";
import { BOSS_ROSTER, EXIT_BOSS_COUNT } from "@/lib/exit-bosses";
import {
  generateExitPhrase,
  signBossToken,
  signPhraseToken,
  verifyBossToken,
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

function parseClientPagesParam(raw: string | null): number[] {
  if (!raw?.trim()) return [];
  const nums = raw
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return Array.from(new Set(nums));
}

function mergePageIndexes(...lists: number[][]): number[] {
  return Array.from(new Set(lists.flat().filter((n) => n > 0)));
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

  const session = await db.query.studySessions.findFirst({
    where: (s, { eq: e }) => e(s.id, sessionId),
    columns: { documentJson: true, visitedPagesList: true },
  });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const pages = mergePageIndexes(
    parseClientPagesParam(new URL(request.url).searchParams.get("pages")),
    await visitedPagesForSession(sessionId, session.visitedPagesList)
  );
  const sourceKey = sourceKeyFromDocJson(session.documentJson);
  const documentId = documentIdFromDocJson(session.documentJson);

  // Decode previously-seen bossId tokens so the bank can deprioritise them.
  const seenParam = new URL(request.url).searchParams.get("seen") ?? "";
  const excludeRowIds = new Set<string>();
  if (seenParam) {
    for (const tok of seenParam.split(",")) {
      const t = tok.trim();
      if (!t) continue;
      const payload = verifyBossToken(t, sessionId);
      if (payload?.bankRowId) excludeRowIds.add(payload.bankRowId);
    }
  }

  const picks = await queryMcQuestionsForPages({
    sourceKey,
    documentId,
    pageIndexes: pages,
    limit: EXIT_BOSS_COUNT,
    excludeRowIds: excludeRowIds.size > 0 ? excludeRowIds : undefined,
  });

  const phrase = generateExitPhrase();
  const phraseChallenge = {
    token: signPhraseToken({ sessionId, phrase }),
    phrase,
    hint: "Type the phrase exactly to unlock the exit",
  };

  // Pick one random persona for the whole fight — all hit-questions share the same boss.
  const persona = BOSS_ROSTER[Math.floor(Math.random() * BOSS_ROSTER.length)];
  const bosses = picks.map((pick) => {
    const shuffled = shuffleMcOptions(pick);
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
