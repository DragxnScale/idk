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

// OpenAI structured outputs reject `oneOf` / discriminated unions, so we use a
// single flat schema where every field is always present and normalise
// per-type in TypeScript after the call.
const flatQuestionSchema = z.object({
  type: z.enum(["mc", "sa"]),
  question: z.string(),
  options: z.array(z.string()).length(4),
  correctIndex: z.number().int().min(0).max(3),
  answer: z.string(),
  topic: z.string(),
  explanation: z.string(),
});

const payloadSchema = z.object({
  questions: z.array(flatQuestionSchema).min(1).max(MAX_QUESTIONS),
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

SCHEMA (EVERY FIELD MUST BE PRESENT ON EVERY QUESTION — no exceptions):
- type: "mc" or "sa"
- question: one short sentence, ideally under 120 characters
- options: ALWAYS an array of exactly 4 strings
- correctIndex: integer 0–3
- answer: a short canonical answer string (1–4 words)
- topic: short topic label (2–5 words) naming the concept
- explanation: one short sentence explaining why the answer is correct

Per-type rules:
- "mc" (multiple choice, ~60% of questions): "options" holds 4 plausible options, "correctIndex" points at the correct one, and "answer" MUST equal options[correctIndex] verbatim. Vary the correct position across questions — don't always put it at index 0.
- "sa" (short answer, ~40% of questions): "answer" is the canonical short noun phrase the student should type. Because the schema still requires 4 options, set "options" to four plausible-but-incorrect distractor phrases (used only as extra hints) and "correctIndex" to 0. The student will type free text — the distractors are not shown.

Prioritise foundational ideas over trivia. Keep explanations short and concrete.`;

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
        const correctIdx = Math.min(3, Math.max(0, q.correctIndex)) as 0 | 1 | 2 | 3;
        return shuffleMc({
          type: "mc",
          question: q.question,
          options: q.options as [string, string, string, string],
          correctIndex: correctIdx,
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
