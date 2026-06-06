import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { openai, MODEL, isAiConfigured, wrapUntrusted } from "@/lib/ai";
import { db } from "@/lib/db";
import { buildAiSystemPrompt } from "@/lib/app-settings";
import { flashcards, aiNotes } from "@/lib/db/schema";
import { assertAiBudget, recordAiUsage } from "@/lib/ai-usage";
import { resolveDocumentFromSession } from "@/lib/document-ai-cache";

/** Allow up to 60s for slow OpenAI responses. See velocity/route.ts. */
export const maxDuration = 60;

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

  const pageNumbers = Array.from(
    new Set(notes.map((n) => n.pageNumber).filter((p): p is number => p != null))
  );

  const resolvedDoc = await resolveDocumentFromSession(sessionId, user.id);
  let existingCards: typeof flashcards.$inferSelect[] = [];

  if (resolvedDoc && pageNumbers.length > 0) {
    existingCards = await db.query.flashcards.findMany({
      where: and(
        eq(flashcards.documentId, resolvedDoc.documentId),
        inArray(flashcards.pageNumber, pageNumbers)
      ),
    });
  }

  const coveredPages = new Set(
    existingCards.map((c) => c.pageNumber).filter((p): p is number => p != null)
  );
  const notesToGenerate = notes.filter(
    (n) => n.pageNumber == null || !coveredPages.has(n.pageNumber)
  );

  if (notesToGenerate.length > 0) {
    const notesSummary = notesToGenerate
      .map((n) => `[Page ${n.pageNumber ?? "?"}]\n${n.content}`)
      .join("\n\n---\n\n");

    const baseSystem = `You are a study assistant generating reference flashcards from study notes.

These flashcards are NOT a quiz — they are a reference tool for understanding and applying material.

CARD FORMAT — for each key term, formula, law, or concept in the notes, create one flashcard:
- front: the term, formula name, or concept label (short — one phrase, e.g. "Newton's Second Law", "Osmosis", "Pythagorean theorem", "Ideal Gas Law")
- back: a clear, plain-language definition or explanation of what it IS and how it is APPLIED. 2-5 sentences max.
- pageNumber: the page number from the notes tag, or null if unclear

FORMULA COVERAGE (highest priority — do not skip any):
- Every named formula, equation, law, or quantitative relationship that appears in the notes MUST get its OWN dedicated flashcard. Do not bundle two formulas onto one card. Do not skip a formula because it "looks similar" to another one.
- Examples of what counts as a formula: Ideal Gas Law, Boyle's Law, Combined Gas Law, F = ma, kinetic energy formula, half-life equation, quadratic formula, Pythagorean theorem, exponential decay, dilution equation (M1V1 = M2V2), etc.
- For a formula card, the back MUST contain BOTH:
  1. The equation written in plain text on its own line (e.g. "PV = nRT" or "F = m × a"), AND
  2. A definition of EVERY variable in the equation, one per line, with units when applicable.
  Example for Ideal Gas Law:
    "PV = nRT
    P = pressure (atm or Pa)
    V = volume (L or m³)
    n = number of moles (mol)
    R = ideal gas constant (0.0821 L·atm/(mol·K) or 8.314 J/(mol·K))
    T = temperature (Kelvin)
    Used to relate the pressure, volume, temperature, and amount of an ideal gas."
- ALWAYS prioritize formula cards: if you have to pick which cards to keep under a budget, formula cards beat vocabulary cards beat trivia.
- For constants that appear inside formulas (e.g. R, c, h, g, π), define them on the formula's card; do NOT make a separate card for the constant unless the notes explicitly devote a section to that constant.

VOCABULARY / CONCEPT CARDS (secondary):
- After every formula has its own card, cover the remaining important terms, definitions, units, processes, and principles from the notes.

RULES:
- NEVER write a question on the front. The front is always a term, name, or concept label.
- NEVER write "What is X?" — just write "X".
- Skip trivial details, dates, or proper nouns that don't need explaining.
- No upper limit on count when notes contain many formulas — better to ship one card per formula than to drop coverage to hit a target.
- Soft target: ~3-5 cards per page of notes for normal pages, more on pages dense with formulas.`;

    const flashcardsPrompt = `Generate flashcards from the study notes below.\n\n${wrapUntrusted(
      "study notes",
      notesSummary.slice(0, 12000)
    )}`;
    const system = await buildAiSystemPrompt(baseSystem, "flashcards");
    const { object, usage } = await generateObject({
      model: openai(MODEL),
      schema: flashcardSchema,
      system,
      prompt: flashcardsPrompt,
    });
    await recordAiUsage(user.id, "/api/ai/flashcards", usage, {
      inputText: flashcardsPrompt,
      outputText: JSON.stringify(object, null, 2),
    });

    const now = new Date();
    const newRows = object.cards.map((card) => ({
      id: crypto.randomUUID(),
      sessionId,
      documentId: resolvedDoc?.documentId ?? null,
      front: card.front,
      back: card.back,
      pageNumber: card.pageNumber ?? null,
      createdAt: now,
    }));

    if (newRows.length > 0) {
      await db.insert(flashcards).values(newRows);
    }

    const allCards = [...existingCards, ...newRows];
    allCards.sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0));

    return NextResponse.json({
      cards: allCards.map((c) => ({
        id: c.id,
        sessionId: c.sessionId,
        front: c.front,
        back: c.back,
        pageNumber: c.pageNumber,
        createdAt: c.createdAt,
      })),
    });
  }

  if (existingCards.length > 0) {
    existingCards.sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0));
    return NextResponse.json({
      cards: existingCards.map((c) => ({
        id: c.id,
        sessionId: c.sessionId,
        front: c.front,
        back: c.back,
        pageNumber: c.pageNumber,
        createdAt: c.createdAt,
      })),
    });
  }

  const sessionCards = await db.query.flashcards.findMany({
    where: eq(flashcards.sessionId, sessionId),
  });
  sessionCards.sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0));

  return NextResponse.json({
    cards: sessionCards.map((c) => ({
      id: c.id,
      sessionId: c.sessionId,
      front: c.front,
      back: c.back,
      pageNumber: c.pageNumber,
      createdAt: c.createdAt,
    })),
  });
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
