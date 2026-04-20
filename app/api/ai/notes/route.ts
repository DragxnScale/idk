import { NextResponse } from "next/server";
import { generateText } from "ai";
import { and, eq } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { openai, MODEL, isAiConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { appendOwnerStyleToSystem, getAiOwnerStyleExtra } from "@/lib/app-settings";
import { stripLatexForAiNotes } from "@/lib/ai-notes-render";
import { aiNotes, publicNotes } from "@/lib/db/schema";

/**
 * Bump this whenever the notes system prompt changes.
 * Any public note stored with a lower version is treated as stale and
 * regenerated on next access — the first user to open that page pays the
 * token cost; everyone after gets the cached result.
 */
const PUBLIC_NOTE_PROMPT_VERSION = 1;

const BASE_SYSTEM = `You are a study assistant. Given text from a textbook page, produce concise, well-organized study notes. Use bullet points. Highlight key terms in **bold**. Keep it under 300 words. Focus on the most important concepts, definitions, and formulas.

Never use LaTeX or math typesetting: no \\( \\), \\[ \\], $ delimiters, \\text{}, \\frac, or similar. Write units and equations in plain text (e.g. "1 in = 2.54 cm", "F = ma").`;

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { sessionId, pageNumber, pageText, textbookCatalogId } = body as {
    sessionId: string;
    pageNumber: number;
    pageText: string;
    textbookCatalogId?: string;
  };

  if (!sessionId || !pageText) {
    return NextResponse.json({ error: "sessionId and pageText are required" }, { status: 400 });
  }

  let content: string;

  // ── Check public notes cache for catalog textbooks ──────────────────
  if (textbookCatalogId) {
    const cached = await db.query.publicNotes.findFirst({
      where: and(
        eq(publicNotes.textbookCatalogId, textbookCatalogId),
        eq(publicNotes.pageNumber, pageNumber),
        eq(publicNotes.promptVersion, PUBLIC_NOTE_PROMPT_VERSION)
      ),
    });

    if (cached) {
      // Cache hit — save to user session without calling OpenAI
      const id = crypto.randomUUID();
      await db.insert(aiNotes).values({
        id,
        sessionId,
        pageNumber,
        content: cached.content,
        createdAt: new Date(),
      });
      return NextResponse.json({ id, pageNumber, content: cached.content });
    }
  }

  // ── Cache miss or personal note — call OpenAI ───────────────────────
  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI not configured. Set OPENAI_API_KEY in your environment." },
      { status: 503 }
    );
  }

  const ownerExtra = await getAiOwnerStyleExtra();
  const { text: rawNotes } = await generateText({
    model: openai(MODEL),
    system: appendOwnerStyleToSystem(BASE_SYSTEM, ownerExtra),
    prompt: `Page ${pageNumber}:\n\n${pageText.slice(0, 6000)}`,
  });

  content = stripLatexForAiNotes(rawNotes);

  // ── Save to user session ────────────────────────────────────────────
  const id = crypto.randomUUID();
  await db.insert(aiNotes).values({
    id,
    sessionId,
    pageNumber,
    content,
    createdAt: new Date(),
  });

  // ── Populate public cache for catalog textbooks ─────────────────────
  if (textbookCatalogId) {
    const now = new Date();
    // Use insert-or-replace to handle the rare race condition where two
    // users hit the same page simultaneously.
    const existingPublic = await db.query.publicNotes.findFirst({
      where: and(
        eq(publicNotes.textbookCatalogId, textbookCatalogId),
        eq(publicNotes.pageNumber, pageNumber)
      ),
    });
    if (existingPublic) {
      await db
        .update(publicNotes)
        .set({ content, promptVersion: PUBLIC_NOTE_PROMPT_VERSION, updatedAt: now })
        .where(eq(publicNotes.id, existingPublic.id));
    } else {
      await db.insert(publicNotes).values({
        id: crypto.randomUUID(),
        textbookCatalogId,
        pageNumber,
        content,
        promptVersion: PUBLIC_NOTE_PROMPT_VERSION,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return NextResponse.json({ id, pageNumber, content });
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

  const notes = await db.query.aiNotes.findMany({
    where: (n, { eq }) => eq(n.sessionId, sessionId),
  });

  notes.sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0));

  return NextResponse.json(notes);
}
