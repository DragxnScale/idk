import { NextResponse } from "next/server";
import { requireSuperOwner } from "@/lib/admin";
import {
  getAiModelSettings,
  patchAiModelSettings,
} from "@/lib/ai-model-config";
import { AI_MODEL_PRESETS } from "@/lib/owner-ai-settings-shared";
import {
  getOwnerAiSettings,
  patchOwnerAiSettingsFromFields,
  type OwnerAiSettings,
  type OwnerAiSettingsPatch,
} from "@/lib/app-settings";

async function settingsToResponse(settings: OwnerAiSettings) {
  const modelSettings = await getAiModelSettings();
  return {
    model: modelSettings.modelId,
    reasoningMode: modelSettings.reasoningMode,
    modelPresets: AI_MODEL_PRESETS,
    settings,
    /** @deprecated use settings.aiOwnerStyle */
    noteStyleExtra: settings.aiOwnerStyle,
  };
}

export async function GET() {
  const session = await requireSuperOwner();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const settings = await getOwnerAiSettings();
  return NextResponse.json(await settingsToResponse(settings));
}

export async function PATCH(request: Request) {
  const session = await requireSuperOwner();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));

  const patch: OwnerAiSettingsPatch = {};
  const modelPatch: { modelId?: string; reasoningMode?: string } = {};

  if (typeof body.aiModel === "string" || typeof body.model === "string") {
    modelPatch.modelId =
      typeof body.aiModel === "string" ? body.aiModel : body.model;
  }
  if (typeof body.aiReasoningMode === "string") {
    modelPatch.reasoningMode = body.aiReasoningMode;
  }
  if (typeof body.reasoningMode === "string") {
    modelPatch.reasoningMode = body.reasoningMode;
  }

  if (typeof body.noteStyleExtra === "string") {
    patch.aiOwnerStyle = body.noteStyleExtra;
  }
  if (typeof body.aiOwnerStyle === "string") patch.aiOwnerStyle = body.aiOwnerStyle;
  if (typeof body.aiProductContext === "string") patch.aiProductContext = body.aiProductContext;
  if (typeof body.aiNotesExtra === "string") patch.aiNotesExtra = body.aiNotesExtra;
  if (typeof body.aiQuizExtra === "string") patch.aiQuizExtra = body.aiQuizExtra;
  if (typeof body.aiFlashcardsExtra === "string") {
    patch.aiFlashcardsExtra = body.aiFlashcardsExtra;
  }
  if (typeof body.aiVelocityExtra === "string") patch.aiVelocityExtra = body.aiVelocityExtra;
  if (typeof body.aiVideosExtra === "string") patch.aiVideosExtra = body.aiVideosExtra;

  if (body.settings && typeof body.settings === "object") {
    const s = body.settings as Record<string, unknown>;
    if (typeof s.aiOwnerStyle === "string") patch.aiOwnerStyle = s.aiOwnerStyle;
    if (typeof s.aiProductContext === "string") patch.aiProductContext = s.aiProductContext;
    if (typeof s.aiNotesExtra === "string") patch.aiNotesExtra = s.aiNotesExtra;
    if (typeof s.aiQuizExtra === "string") patch.aiQuizExtra = s.aiQuizExtra;
    if (typeof s.aiFlashcardsExtra === "string") patch.aiFlashcardsExtra = s.aiFlashcardsExtra;
    if (typeof s.aiVelocityExtra === "string") patch.aiVelocityExtra = s.aiVelocityExtra;
    if (typeof s.aiVideosExtra === "string") patch.aiVideosExtra = s.aiVideosExtra;
  }

  const hasModelPatch =
    modelPatch.modelId !== undefined || modelPatch.reasoningMode !== undefined;

  if (Object.keys(patch).length === 0 && !hasModelPatch) {
    return NextResponse.json({ error: "No settings to update" }, { status: 400 });
  }

  try {
    if (hasModelPatch) {
      await patchAiModelSettings({
        ...(modelPatch.modelId !== undefined ? { modelId: modelPatch.modelId } : {}),
        ...(modelPatch.reasoningMode === "instant" || modelPatch.reasoningMode === "thinking"
          ? { reasoningMode: modelPatch.reasoningMode }
          : {}),
      });
    }
    const settings =
      Object.keys(patch).length > 0
        ? await patchOwnerAiSettingsFromFields(patch)
        : await getOwnerAiSettings();
    return NextResponse.json({ ok: true, ...(await settingsToResponse(settings)) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed" },
      { status: 400 }
    );
  }
}
