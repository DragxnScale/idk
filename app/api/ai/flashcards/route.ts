import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { openai, MODEL, isAiConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { appendOwnerStyleToSystem, getAiOwnerStyleExtra } from "@/lib/app-settings";
import { flashcards, aiNotes } from "@/lib/db/schema";
import { assertAiBudget, recordAiUsage } from "@/lib/ai-usage";

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
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI not configured. Set OPENAI_API_KEY in your environment." },
      { status: 503 }
    );
  }

  const overBudget = await assertAiBudget(user.id);
  if (overBudget) return overBudget;

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
  const baseSystem = `You are a study assistant generating reference flashcards from study notes.

These flashcards are NOT a quiz — they are a reference tool for understanding and applying material.

For each key term, formula, law, or concept in the notes, create one flashcard:
- front: the term, formula name, or concept label (short — one phrase, e.g. "Newton's Second Law", "Osmosis", "Pythagorean theorem")
- back: a clear, plain-language definition or explanation of what it IS and how it is APPLIED. Include the formula or equation written in plain text if applicable (e.g. "F = m × a"). 2-4 sentences max.
- pageNumber: the page number from the notes tag, or null if unclear

Rules:
- NEVER write a question on the front. The front is always a term, name, or concept label.
- NEVER write "What is X?" — just write "X".
- Focus on vocabulary, definitions, formulas, units, processes, and principles.
- Skip trivial details, dates, or proper nouns that don't need explaining.
- Target ~3 cards per page of notes.`;

  const { object, usage } = await generateObject({
    model: openai(MODEL),
    schema: flashcardSchema,
    system: appendOwnerStyleToSystem(baseSystem, ownerExtra),
    prompt: `Study notes:\n\n${notesSummary.slice(0, 12000)}`,
  });
  await recordAiUsage(user.id, "/api/ai/flashcards", usage);

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
  const user = await getAppUser();
  if (!user?.id) {
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
