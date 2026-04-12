import { NextResponse } from "next/server";
import { generateText } from "ai";
import { auth } from "@/lib/auth";
import { openai, MODEL, isAiConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { appendOwnerStyleToSystem, getAiOwnerStyleExtra } from "@/lib/app-settings";
import { stripLatexForAiNotes } from "@/lib/ai-notes-render";
import { aiNotes } from "@/lib/db/schema";

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
  const { sessionId, pageNumber, pageText } = body as {
    sessionId: string;
    pageNumber: number;
    pageText: string;
  };

  if (!sessionId || !pageText) {
    return NextResponse.json({ error: "sessionId and pageText are required" }, { status: 400 });
  }

  const ownerExtra = await getAiOwnerStyleExtra();
  const baseSystem = `You are a study assistant. Given text from a textbook page, produce concise, well-organized study notes. Use bullet points. Highlight key terms in **bold**. Keep it under 300 words. Focus on the most important concepts, definitions, and formulas.

Never use LaTeX or math typesetting: no \\( \\), \\[ \\], $ delimiters, \\text{}, \\frac, or similar. Write units and equations in plain text (e.g. "1 in = 2.54 cm", "F = ma").`;

  const { text: rawNotes } = await generateText({
    model: openai(MODEL),
    system: appendOwnerStyleToSystem(baseSystem, ownerExtra),
    prompt: `Page ${pageNumber}:\n\n${pageText.slice(0, 6000)}`,
  });

  const notes = stripLatexForAiNotes(rawNotes);

  const id = crypto.randomUUID();
  await db.insert(aiNotes).values({
    id,
    sessionId,
    pageNumber,
    content: notes,
    createdAt: new Date(),
  });

  return NextResponse.json({ id, pageNumber, content: notes });
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

  const notes = await db.query.aiNotes.findMany({
    where: (n, { eq }) => eq(n.sessionId, sessionId),
  });

  notes.sort((a, b) => (a.pageNumber ?? 0) - (b.pageNumber ?? 0));

  return NextResponse.json(notes);
}
