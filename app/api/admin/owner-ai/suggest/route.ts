import { NextResponse } from "next/server";
import { generateText } from "ai";
import { requireSuperOwner } from "@/lib/admin";
import { openai, MODEL, isAiConfigured } from "@/lib/ai";
import { getOwnerAiSettings } from "@/lib/app-settings";
import {
  buildOwnerAnalysisAddendum,
  buildOwnerChatSystemPrompt,
} from "@/lib/owner-ai-context";
import {
  buildInsightsSummary,
  formatInsightsForAnalysis,
  gatherOwnerAiInsights,
} from "@/lib/owner-ai-insights";
import { recordAiUsage } from "@/lib/ai-usage";

export const maxDuration = 60;

export async function POST() {
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

  try {
    const insights = await gatherOwnerAiInsights();
    const settings = await getOwnerAiSettings();
    const userMessage = formatInsightsForAnalysis(insights);
    const systemPrompt =
      buildOwnerChatSystemPrompt(settings) + buildOwnerAnalysisAddendum();

    const { text, usage } = await generateText({
      model: openai(MODEL),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    if (session.user?.id) {
      await recordAiUsage(session.user.id, "/api/admin/owner-ai/suggest", usage, {
        inputText: userMessage.slice(0, 8000),
        outputText: text,
      });
    }

    return NextResponse.json({
      role: "assistant" as const,
      content: text,
      insightsSummary: buildInsightsSummary(insights),
    });
  } catch (e) {
    console.error("[owner-ai/suggest]", e);
    return NextResponse.json(
      { error: (e as Error).message || "OpenAI request failed" },
      { status: 502 }
    );
  }
}
