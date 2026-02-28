import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { openai, MODEL, isAiConfigured } from "@/lib/ai";
import { store } from "@/lib/store";

const quizSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.string()).length(4),
      correctIndex: z.number().min(0).max(3),
      explanation: z.string(),
    })
  ),
  review: z.object({
    keyConcepts: z.array(z.string()),
    thingsToReview: z.array(z.string()),
    videoSuggestions: z.array(
      z.object({
        title: z.string(),
        searchQuery: z.string(),
      })
    ),
  }),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI not configured. Set OPENAI_API_KEY in your environment." },
      { status: 503 }
    );
  }

  const body = await request.json();
  const { sessionId, accumulatedText } = body as {
    sessionId: string;
    accumulatedText: string;
  };

  if (!sessionId || !accumulatedText) {
    return NextResponse.json(
      { error: "sessionId and accumulatedText are required" },
      { status: 400 }
    );
  }

  const existingNotes = store.getNotesBySession(sessionId);
  const notesContext = existingNotes.map((n) => n.content).join("\n\n");

  const { object } = await generateObject({
    model: openai(MODEL),
    schema: quizSchema,
    system: `You are a study assistant creating an end-of-session quiz and review material.

Given the reading text and any notes, generate:
1. 5-8 multiple choice questions testing comprehension of the key concepts.
   Each question has exactly 4 options, one correct answer (correctIndex 0-3), and a brief explanation.
2. Review material:
   - keyConcepts: 4-6 most important concepts from the reading
   - thingsToReview: 3-5 specific topics the student should review further
   - videoSuggestions: 2-3 YouTube search queries that would find helpful explainer videos on the topics`,
    prompt: `Reading material:\n${accumulatedText.slice(0, 10000)}\n\n${
      notesContext ? `Session notes:\n${notesContext.slice(0, 3000)}` : ""
    }`,
  });

  const id = crypto.randomUUID();
  store.createQuiz({
    id,
    sessionId,
    questionsJson: JSON.stringify(object.questions),
    reviewJson: JSON.stringify(object.review),
    totalQuestions: object.questions.length,
    score: null,
    createdAt: new Date().toISOString(),
  });

  return NextResponse.json({ id, ...object });
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 }
    );
  }

  const quiz = store.getQuizBySession(sessionId);

  if (!quiz) {
    return NextResponse.json(
      { error: "No quiz found for this session" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    id: quiz.id,
    sessionId: quiz.sessionId,
    questions: JSON.parse(quiz.questionsJson),
    review: quiz.reviewJson ? JSON.parse(quiz.reviewJson) : null,
    score: quiz.score,
    totalQuestions: quiz.totalQuestions,
  });
}
