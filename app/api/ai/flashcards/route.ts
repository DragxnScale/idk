import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { openai, MODEL, isAiConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { appendOwnerStyleToSystem, getAiOwnerStyleExtra } from "@/lib/app-settings";
import { flashcards, aiNotes } from "@/lib/db/schema";

const flashcardSchema = z.object({
  cards: z.array(
    z.object({
      front: z.string(),
      back: z.string(),
      pageNumber: z.number().int().nullable(),
    })
  ),
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

  const body = await request.json() as { sessionId: string };
  const { sessionId } = body;

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  // Fetch existing notes for this session
  const notes = await db.query.aiNotes.findMany({
    where: eq(aiNotes.sessionId, sessionId),
  });
  notes.sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0));

  if (notes.length === 0) {
    return NextResponse.json(
      { error: "No AI notes found for this session. Generate notes first." },
      { status: 400 }
    );
  }

  const notesSummary = notes
    .map((n) => `[Page ${n.pageNumber ?? "?"}]\n${n.content}`)
    .join("\n\n---\n\n");

  const ownerExtra = await getAiOwnerStyleExtra();
  const baseSystem = `You are a study assistant generating flashcards from study notes.

For each key term, concept, or formula in the notes, create one flashcard:
- front: the term, concept name, or question (keep it short — one phrase)
- back: a concise but complete definition or answer (1-3 sentences max)
- pageNumber: the page number from the notes tag, or null if unclear

Rules:
- Target ~3 cards per page of notes but skip trivial or obvious facts.
- Prefer definitions, processes, formulas, and cause-effect relationships.
- front should be specific enough to be useful as a memory cue.
- back should be self-contained — the student should not need to look elsewhere.`;

  const { object } = await generateObject({
    model: openai(MODEL),
    schema: flashcardSchema,
    system: appendOwnerStyleToSystem(baseSystem, ownerExtra),
    prompt: `Study notes:\n\n${notesSummary.slice(0, 12000)}`,
  });

  // Persist
  const now = new Date();
  const rows = object.cards.map((card) => ({
    id: crypto.randomUUID(),
    sessionId,
    front: card.front,
    back: card.back,
    pageNumber: card.pageNumber ?? null,
    createdAt: now,
  }));

  await db.insert(flashcards).values(rows);

  return NextResponse.json({ cards: rows });
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const cards = await db.query.flashcards.findMany({
    where: eq(flashcards.sessionId, sessionId),
  });
  cards.sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0));

  return NextResponse.json({ cards });
}
