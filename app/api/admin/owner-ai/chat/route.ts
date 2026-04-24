import { NextResponse } from "next/server";
import { generateText } from "ai";
import { requireSuperOwner } from "@/lib/admin";
import { openai, MODEL, isAiConfigured } from "@/lib/ai";
import { recordAiUsage } from "@/lib/ai-usage";

const MAX_MESSAGES = 24;
const MAX_MSG_LEN = 4000;

type Role = "user" | "assistant" | "system";

export async function POST(request: Request) {
  const session = await requireSuperOwner();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const raw = body.messages as unknown;
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json(
      { error: "messages must be a non-empty array" },
      { status: 400 }
    );
  }
  if (raw.length > MAX_MESSAGES) {
    return NextResponse.json(
      { error: `At most ${MAX_MESSAGES} messages` },
      { status: 400 }
    );
  }

  const messages: { role: Role; content: string }[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") {
      return NextResponse.json({ error: "Invalid message" }, { status: 400 });
    }
    const role = (m as { role?: string }).role;
    const content = (m as { content?: string }).content;
    if (role !== "user" && role !== "assistant" && role !== "system") {
      return NextResponse.json({ error: "Invalid message role" }, { status: 400 });
    }
    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Invalid message content" }, { status: 400 });
    }
    if (content.length > MAX_MSG_LEN) {
      return NextResponse.json(
        { error: `Each message must be under ${MAX_MSG_LEN} characters` },
        { status: 400 }
      );
    }
    messages.push({ role, content });
  }

  try {
    const { text, usage } = await generateText({
      model: openai(MODEL),
      messages,
    });
    // Owner chat is super-admin only; no budget gate (owner has no cap) but
    // we still record so the admin dashboard shows the tokens spent.
    if (session.user?.id) {
      await recordAiUsage(session.user.id, "/api/admin/owner-ai/chat", usage);
    }
    return NextResponse.json({ role: "assistant" as const, content: text });
  } catch (e) {
    console.error("[owner-ai/chat]", e);
    return NextResponse.json(
      { error: (e as Error).message || "OpenAI request failed" },
      { status: 502 }
    );
  }
}
