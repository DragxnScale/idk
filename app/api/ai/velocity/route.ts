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

const MAX_QUESTIONS = 30;
const DEFAULT_Q = 25;

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

    const baseSystem = `You are writing exactly ${DEFAULT_Q} rapid-fire quiz-bowl style science questions on the reading, in the style of the NSB (National Science Bowl) middle/high-school competition.

VOICE & FORMAT
- Questions are ONE punchy sentence a moderator could read aloud — ideally under 120 characters.
- No meta phrasing like "Based on the reading…" or "According to the text…".
- Prioritise the most foundational, examinable concepts. Skip trivia and anecdotes.

TYPES (output "type" as "mc" or "sa"; aim for ~60% mc / ~40% sa)
- "mc" (multiple choice): 4 crisp answer options in "options", one is correct. "correctIndex" (0–3) points at it and "answer" MUST equal options[correctIndex] verbatim. Vary the correct position across questions.
- "sa" (short answer): "answer" is a SHORT canonical reply — a noun, number, name, formula, or 1–4 word phrase. Because the schema still requires 4 "options", fill them with four plausible-but-incorrect distractor phrases; they are never shown to the user.

HARD BANS for short-answer questions — do NOT write questions where any of these apply:
- The answer is a full sentence or clause.
- The stem starts with "Why", "Explain", "Describe", "Discuss", "How does", "What happens if", "What is the difference between".
- The answer requires reasoning or justification ("why X causes Y", "explain how").
- The question is multi-part, compound, or asks for more than one fact at once.
- The answer is a list longer than 3 items.
If the concept only yields an essay-style answer, write it as MC instead.

GOOD EXAMPLES (match this tone and brevity)
MC:
- "A photon of what wavelength carries the most energy?" options: ["Red","Ultraviolet","Infrared","Blue"] correctIndex: 1
- "Which of the following is NOT a nucleic acid?" options: ["DNA","RNA","ATP","DNR"] correctIndex: 3
- "On a geology field trip, you come across a sedimentary rock containing ripple marks. These marks might contain information about which of the following?" options: ["Water depth","Seasonal climate variability","Flow direction","Local vegetation"] correctIndex: 2

SA:
- "In what organ does the female germ cell develop?" answer: "ovary"
- "What is the structure capable of transporting dissolved organic material throughout a plant?" answer: "phloem"
- "An atom of what isotope has a nucleus that contains eight protons and ten neutrons?" answer: "oxygen-18"
- "How many constellations are currently officially recognized?" answer: "88"
- "Who was the first American woman to fly in space?" answer: "Sally Ride"

SCHEMA — every field is REQUIRED on EVERY question:
- type, question, options (4 strings), correctIndex (0–3), answer, topic (2–5 words labelling the concept), explanation (one short sentence).`;

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
