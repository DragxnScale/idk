import { NextResponse } from "next/server";
import { requireSuperOwner } from "@/lib/admin";
import { gatherOwnerAiInsights } from "@/lib/owner-ai-insights";

export async function GET() {
  const session = await requireSuperOwner();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const insights = await gatherOwnerAiInsights();
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      insights,
    });
  } catch (e) {
    console.error("[owner-ai/insights]", e);
    return NextResponse.json(
      { error: "Failed to gather insights" },
      { status: 500 }
    );
  }
}
