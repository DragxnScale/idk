import { NextResponse } from "next/server";
import { generateText } from "ai";
import { and, eq } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { openai, MODEL, isAiConfigured, wrapUntrusted, UNTRUSTED_INPUT_GUARD } from "@/lib/ai";
import { db } from "@/lib/db";
import { appendOwnerStyleToSystem, getAiOwnerStyleExtra } from "@/lib/app-settings";
import { stripLatexForAiNotes } from "@/lib/ai-notes-render";
import { aiNotes, documentNotes, publicNotes } from "@/lib/db/schema";
import { assertAiBudget, recordAiUsage } from "@/lib/ai-usage";
import { assertDocumentOwner } from "@/lib/document-ai-cache";

/** Allow up to 60s for slow OpenAI responses. See velocity/route.ts. */
export const maxDuration = 60;

/**
 * Bump this whenever the notes system prompt changes.
 * Any public note stored with a lower version is treated as stale and
 * regenerated on next access — the first user to open that page pays the
 * token cost; everyone after gets the cached result.
 */
const PUBLIC_NOTE_PROMPT_VERSION = 1;

/** Bump when upload document-notes prompt changes (invalidates document_notes cache). */
const DOCUMENT_NOTE_PROMPT_VERSION = 1;

const BASE_SYSTEM = `You are a study assistant. Given text from a textbook page, produce concise, well-organized study notes. Use bullet points. Highlight key terms in **bold**. Keep it under 300 words. Focus on the most important concepts, definitions, and formulas.

Never use LaTeX or math typesetting: no \\( \\), \\[ \\], $ delimiters, \\text{}, \\frac, or similar. Write units and equations in plain text (e.g. "1 in = 2.54 cm", "F = ma").`;

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { sessionId, pageNumber, pageText, textbookCatalogId, documentId } = body as {
    sessionId: string;
    pageNumber: number;
    pageText: string;
    textbookCatalogId?: string;
    documentId?: string;
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

  // ── Check document notes cache for uploads ───────────────────────────
  if (documentId && !textbookCatalogId) {
    const owned = await assertDocumentOwner(documentId, user.id);
    if (owned) {
      const cached = await db.query.documentNotes.findFirst({
        where: and(
          eq(documentNotes.documentId, documentId),
          eq(documentNotes.pageNumber, pageNumber),
          eq(documentNotes.promptVersion, DOCUMENT_NOTE_PROMPT_VERSION)
        ),
      });

      if (cached) {
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
  }

  // ── Cache miss or personal note — call OpenAI ───────────────────────
  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI not configured. Set OPENAI_API_KEY in your environment." },
      { status: 503 }
    );
  }

  const overBudget = await assertAiBudget(user.id);
  if (overBudget) return overBudget;

  const ownerExtra = await getAiOwnerStyleExtra();
  const notesPrompt = `Generate notes for page ${pageNumber} of the textbook.\n\n${wrapUntrusted(
    "page text",
    pageText.slice(0, 6000)
  )}`;
  const { text: rawNotes, usage } = await generateText({
    model: openai(MODEL),
    system: appendOwnerStyleToSystem(BASE_SYSTEM, ownerExtra) + UNTRUSTED_INPUT_GUARD,
    prompt: notesPrompt,
  });
  await recordAiUsage(user.id, "/api/ai/notes", usage, {
    inputText: notesPrompt,
    outputText: rawNotes,
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

  // ── Populate document cache for uploads ─────────────────────────────
  if (documentId && !textbookCatalogId) {
    const owned = await assertDocumentOwner(documentId, user.id);
    if (owned) {
      const now = new Date();
      const existingDoc = await db.query.documentNotes.findFirst({
        where: and(
          eq(documentNotes.documentId, documentId),
          eq(documentNotes.pageNumber, pageNumber)
        ),
      });
      if (existingDoc) {
        await db
          .update(documentNotes)
          .set({
            content,
            promptVersion: DOCUMENT_NOTE_PROMPT_VERSION,
            updatedAt: now,
          })
          .where(eq(documentNotes.id, existingDoc.id));
      } else {
        await db.insert(documentNotes).values({
          id: crypto.randomUUID(),
          documentId,
          pageNumber,
          content,
          promptVersion: DOCUMENT_NOTE_PROMPT_VERSION,
          createdAt: now,
          updatedAt: now,
        });
      }
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
