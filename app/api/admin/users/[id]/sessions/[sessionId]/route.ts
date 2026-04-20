import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { pageVisits } from "@/lib/db/schema";

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

  // ── Quiz performance (optional) ─────────────────────────────────────
  const quizRow = await db.query.quizzes.findFirst({
    where: (q, { eq: e }) => e(q.sessionId, params.sessionId),
  });
  let quiz: {
    id: string;
    score: number | null;
    totalQuestions: number | null;
    accuracy: number | null;
    completed: boolean;
    createdAt: string | null;
    questions: {
      question: string;
      options: string[];
      correctIndex: number;
      explanation?: string;
    }[];
    review: unknown;
  } | null = null;
  if (quizRow) {
    let questions: {
      question: string;
      options: string[];
      correctIndex: number;
      explanation?: string;
    }[] = [];
    try {
      questions = JSON.parse(quizRow.questionsJson);
    } catch {}
    let review: unknown = null;
    if (quizRow.reviewJson) {
      try {
        review = JSON.parse(quizRow.reviewJson);
      } catch {}
    }
    const score = quizRow.score;
    const total = quizRow.totalQuestions ?? questions.length;
    quiz = {
      id: quizRow.id,
      score: score ?? null,
      totalQuestions: total,
      accuracy:
        score != null && total > 0 ? Math.round((score / total) * 100) : null,
      completed: score != null,
      createdAt: quizRow.createdAt?.toISOString() ?? null,
      questions,
      review,
    };
  }

  // ── Velocity performance (optional) ────────────────────────────────
  const velocityRow = await db.query.velocityGames.findFirst({
    where: (g, { eq: e }) => e(g.sessionId, params.sessionId),
  });
  type VelocityAttempt = {
    topic: string;
    question: string;
    userAnswer?: string;
    correctAnswer: string;
    correct: boolean;
    reactionMs: number | null;
    type: "mc" | "sa";
  };
  let velocity: {
    id: string;
    accuracy: number | null;
    avgReactionMs: number | null;
    fastestMs: number | null;
    slowestMs: number | null;
    correctCount: number;
    total: number;
    score: number;
    negCount: number;
    streakBest: number;
    completed: boolean;
    createdAt: string | null;
    completedAt: string | null;
    attempts: VelocityAttempt[];
    review: unknown;
  } | null = null;
  if (velocityRow) {
    let attempts: VelocityAttempt[] = [];
    let fastestMs: number | null = null;
    let slowestMs: number | null = null;
    let correctCount = 0;
    let total = 0;
    let score = 0;
    let negCount = 0;
    let streakBest = 0;
    if (velocityRow.resultsJson) {
      try {
        const parsed = JSON.parse(velocityRow.resultsJson) as {
          attempts?: VelocityAttempt[];
          fastestMs?: number | null;
          slowestMs?: number | null;
          correctCount?: number;
          total?: number;
          score?: number;
          negCount?: number;
          streakBest?: number;
        };
        attempts = parsed.attempts ?? [];
        fastestMs = parsed.fastestMs ?? null;
        slowestMs = parsed.slowestMs ?? null;
        correctCount = parsed.correctCount ?? attempts.filter((a) => a.correct).length;
        total = parsed.total ?? attempts.length;
        score = parsed.score ?? 0;
        negCount = parsed.negCount ?? 0;
        streakBest = parsed.streakBest ?? 0;
      } catch {}
    }
    if (!total) {
      try {
        const qs = JSON.parse(velocityRow.questionsJson) as unknown[];
        total = Array.isArray(qs) ? qs.length : 0;
      } catch {}
    }
    let review: unknown = null;
    if (velocityRow.reviewJson) {
      try {
        review = JSON.parse(velocityRow.reviewJson);
      } catch {}
    }
    velocity = {
      id: velocityRow.id,
      accuracy: velocityRow.accuracy ?? null,
      avgReactionMs: velocityRow.avgReactionMs ?? null,
      fastestMs,
      slowestMs,
      correctCount,
      total,
      score,
      negCount,
      streakBest,
      completed: velocityRow.completedAt != null,
      createdAt: velocityRow.createdAt?.toISOString() ?? null,
      completedAt: velocityRow.completedAt?.toISOString() ?? null,
      attempts,
      review,
    };
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
    quiz,
    velocity,
  });
}
