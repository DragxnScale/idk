import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getAppUser } from "@/lib/app-user";
import { openai, MODEL, isAiConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { appendOwnerStyleToSystem, getAiOwnerStyleExtra } from "@/lib/app-settings";
import { velocityGames, clientErrorLogs } from "@/lib/db/schema";
import type { VelocityQuestion } from "@/lib/velocity-match";

/** Record AI / runtime failures so admins can inspect them in the debug log. */
async function logServerFailure(userId: string | null, email: string | null, err: unknown, extra?: unknown) {
  const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
  const stack = err instanceof Error ? err.stack ?? null : null;
  let extraJson: string | null = null;
  try {
    extraJson = extra != null ? JSON.stringify(extra).slice(0, 16000) : null;
  } catch {}
  try {
    await db.insert(clientErrorLogs).values({
      id: crypto.randomUUID(),
      createdAt: new Date(),
      kind: "dev",
      userId,
      email,
      message: `[velocity] ${message}`.slice(0, 4000),
      stack: stack?.slice(0, 32000) ?? null,
      url: null,
      userAgent: null,
      extra: extraJson,
    });
  } catch {
    /* logging must never throw */
  }
}

const MAX_QUESTIONS = 15;
const DEFAULT_Q = 10;

const questionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("mc"),
    question: z.string(),
    options: z.array(z.string()).length(4),
    correctIndex: z.number().int().min(0).max(3),
    topic: z.string(),
    explanation: z.string().optional(),
  }),
  z.object({
    type: z.literal("sa"),
    question: z.string(),
    answer: z.string(),
    topic: z.string(),
    explanation: z.string().optional(),
  }),
]);

const payloadSchema = z.object({
  questions: z.array(questionSchema).min(1).max(MAX_QUESTIONS),
});

function shuffleMc(q: VelocityQuestion): VelocityQuestion {
  if (q.type !== "mc") return q;
  const indices = [0, 1, 2, 3];
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const shuffled = indices.map((i) => q.options[i]) as [string, string, string, string];
  const newCorrect = indices.indexOf(q.correctIndex) as 0 | 1 | 2 | 3;
  return { ...q, options: shuffled, correctIndex: newCorrect };
}

export async function GET(request: Request) {
  const user = await getAppUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const row = await db.query.velocityGames.findFirst({
    where: (g, { eq }) => eq(g.sessionId, sessionId),
  });
  if (!row) return NextResponse.json({ error: "No velocity game found" }, { status: 404 });

  return NextResponse.json({
    id: row.id,
    sessionId: row.sessionId,
    questions: JSON.parse(row.questionsJson) as VelocityQuestion[],
    results: row.resultsJson ? JSON.parse(row.resultsJson) : null,
    review: row.reviewJson ? JSON.parse(row.reviewJson) : null,
    accuracy: row.accuracy,
    avgReactionMs: row.avgReactionMs,
  });
}

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI not configured. Set OPENAI_API_KEY in your environment." },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    sessionId?: string;
    accumulatedText?: string;
  };
  const { sessionId, accumulatedText } = body;
  if (!sessionId || !accumulatedText) {
    return NextResponse.json(
      { error: "sessionId and accumulatedText are required" },
      { status: 400 }
    );
  }

  try {
    const notes = await db.query.aiNotes.findMany({
      where: (n, { eq }) => eq(n.sessionId, sessionId),
    });
    const notesContext = notes.map((n) => n.content).join("\n\n");
    const ownerExtra = await getAiOwnerStyleExtra();

    const baseSystem = `You are designing a rapid-fire reaction-speed quiz for a study session.

Generate exactly ${DEFAULT_Q} punchy questions that test the most essential concepts from the reading.

Rules:
- Mix question types: roughly 60% "mc" (multiple choice) and 40% "sa" (short answer).
- Questions must be SHORT — one sentence, ideally under 120 characters — so they read quickly in a typewriter.
- For "mc" questions provide exactly 4 concise options and a 0-based correctIndex.
- For "sa" questions provide a single canonical "answer" — a short noun phrase (1-4 words) that a student would type. Avoid multi-clause answers.
- Every question has a short "topic" label (2-5 words) naming the concept being tested — used to identify growth areas.
- Prioritise foundational ideas over trivia. Vary the correct MC answer position.
- Optionally include a one-sentence "explanation" for each question.`;

    const { object } = await generateObject({
      model: openai(MODEL),
      schema: payloadSchema,
      system: appendOwnerStyleToSystem(baseSystem, ownerExtra),
      prompt: `Reading material:\n${accumulatedText.slice(0, 10000)}\n\n${
        notesContext ? `Session notes:\n${notesContext.slice(0, 3000)}` : ""
      }`,
    });

    const questions: VelocityQuestion[] = object.questions.map((q) => {
      if (q.type === "mc") {
        return shuffleMc({
          type: "mc",
          question: q.question,
          options: q.options as [string, string, string, string],
          correctIndex: q.correctIndex as 0 | 1 | 2 | 3,
          topic: q.topic,
          explanation: q.explanation,
        });
      }
      return {
        type: "sa",
        question: q.question,
        answer: q.answer,
        topic: q.topic,
        explanation: q.explanation,
      };
    });

    const id = crypto.randomUUID();
    await db.insert(velocityGames).values({
      id,
      sessionId,
      questionsJson: JSON.stringify(questions),
      resultsJson: null,
      reviewJson: null,
      accuracy: null,
      avgReactionMs: null,
      createdAt: new Date(),
      completedAt: null,
    });

    return NextResponse.json({ id, questions });
  } catch (err) {
    await logServerFailure(user.id, user.email ?? null, err, {
      route: "POST /api/ai/velocity",
      sessionId,
      textLength: accumulatedText.length,
    });
    const detail = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to generate Velocity questions: ${detail}` },
      { status: 500 }
    );
  }
}
