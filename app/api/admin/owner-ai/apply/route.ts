import { NextResponse } from "next/server";
import { requireSuperOwner } from "@/lib/admin";
import { getAiModelSettings } from "@/lib/ai-model-config";
import { getOwnerAiSettings, patchOwnerAiSettings } from "@/lib/app-settings";

export async function POST(request: Request) {
  const session = await requireSuperOwner();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const patches = body.patches as unknown;
  if (!patches || typeof patches !== "object" || Array.isArray(patches)) {
    return NextResponse.json({ error: "patches object required" }, { status: 400 });
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(patches as Record<string, unknown>)) {
    if (typeof value !== "string") {
      return NextResponse.json({ error: `Invalid value for ${key}` }, { status: 400 });
    }
    normalized[key] = value;
  }

  if (Object.keys(normalized).length === 0) {
    return NextResponse.json({ error: "No patches provided" }, { status: 400 });
  }

  try {
    const settings = await patchOwnerAiSettings(normalized);
    const { modelId } = await getAiModelSettings();
    return NextResponse.json({
      ok: true,
      model: modelId,
      settings,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Apply failed" },
      { status: 400 }
    );
  }
}

export async function GET() {
  const session = await requireSuperOwner();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const settings = await getOwnerAiSettings();
  const { modelId } = await getAiModelSettings();
  return NextResponse.json({ model: modelId, settings });
}
