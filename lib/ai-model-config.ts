import { eq, inArray } from "drizzle-orm";
import { openai, DEFAULT_MODEL } from "@/lib/ai";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import {
  AI_MODEL_PRESETS,
  AI_MODEL_SETTING_KEY,
  AI_REASONING_MODE_SETTING_KEY,
  type AiReasoningMode,
} from "@/lib/owner-ai-settings-shared";

export {
  AI_MODEL_PRESETS,
  AI_MODEL_SETTING_KEY,
  AI_REASONING_MODE_SETTING_KEY,
  type AiReasoningMode,
} from "@/lib/owner-ai-settings-shared";

const MODEL_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function isValidModelId(id: string): boolean {
  return MODEL_ID_RE.test(id.trim());
}

export function isValidReasoningMode(value: string): value is AiReasoningMode {
  return value === "instant" || value === "thinking";
}

export function modelSupportsReasoning(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.startsWith("gpt-5") ||
    id.startsWith("o1") ||
    id.startsWith("o3") ||
    id.startsWith("o4")
  );
}

function gpt5SupportsReasoningNone(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (!id.startsWith("gpt-5")) return false;
  const minor = id.match(/^gpt-5\.(\d+)/)?.[1];
  if (!minor) return true;
  return parseInt(minor, 10) >= 1;
}

/** Map owner-facing instant/thinking toggle to OpenAI reasoningEffort. */
export function reasoningEffortForMode(
  mode: AiReasoningMode,
  modelId: string
): "none" | "minimal" | "low" | "high" | undefined {
  if (!modelSupportsReasoning(modelId)) return undefined;
  if (mode === "instant") {
    const id = modelId.toLowerCase();
    if (gpt5SupportsReasoningNone(id)) return "none";
    if (id.startsWith("gpt-5")) return "minimal";
    return "low";
  }
  return "high";
}

export interface AiModelSettings {
  modelId: string;
  reasoningMode: AiReasoningMode;
}

export type OpenAiProviderOptions = {
  openai: { reasoningEffort: "none" | "minimal" | "low" | "high" };
};

export interface ResolvedAiModel {
  model: ReturnType<typeof openai>;
  modelId: string;
  reasoningMode: AiReasoningMode;
  providerOptions?: OpenAiProviderOptions;
}

async function upsertModelSetting(key: string, value: string): Promise<void> {
  const now = new Date();
  const existing = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, key),
  });
  if (existing) {
    await db
      .update(appSettings)
      .set({ value, updatedAt: now })
      .where(eq(appSettings.key, key));
  } else {
    await db.insert(appSettings).values({ key, value, updatedAt: now });
  }
}

export async function getAiModelSettings(): Promise<AiModelSettings> {
  const rows = await db.query.appSettings.findMany({
    where: inArray(appSettings.key, [
      AI_MODEL_SETTING_KEY,
      AI_REASONING_MODE_SETTING_KEY,
    ]),
  });

  let modelId = DEFAULT_MODEL;
  let reasoningMode: AiReasoningMode = "instant";

  for (const row of rows) {
    if (row.key === AI_MODEL_SETTING_KEY) {
      const v = (row.value ?? "").trim();
      if (v && isValidModelId(v)) modelId = v;
    }
    if (row.key === AI_REASONING_MODE_SETTING_KEY) {
      const v = (row.value ?? "").trim();
      if (isValidReasoningMode(v)) reasoningMode = v;
    }
  }

  return { modelId, reasoningMode };
}

export async function patchAiModelSettings(
  patch: Partial<AiModelSettings>
): Promise<AiModelSettings> {
  if (patch.modelId !== undefined) {
    const id = patch.modelId.trim();
    if (!isValidModelId(id)) {
      throw new Error("Invalid model id");
    }
    await upsertModelSetting(AI_MODEL_SETTING_KEY, id);
  }
  if (patch.reasoningMode !== undefined) {
    if (!isValidReasoningMode(patch.reasoningMode)) {
      throw new Error("reasoningMode must be instant or thinking");
    }
    await upsertModelSetting(AI_REASONING_MODE_SETTING_KEY, patch.reasoningMode);
  }
  return getAiModelSettings();
}

export async function resolveAiLanguageModel(): Promise<ResolvedAiModel> {
  const { modelId, reasoningMode } = await getAiModelSettings();
  const effort = reasoningEffortForMode(reasoningMode, modelId);
  const providerOptions = effort
    ? { openai: { reasoningEffort: effort } }
    : undefined;

  return {
    model: openai(modelId),
    modelId,
    reasoningMode,
    providerOptions,
  };
}

/** Spread into generateText / generateObject calls. */
export function aiGenerateOptions(resolved: ResolvedAiModel) {
  return {
    model: resolved.model,
    ...(resolved.providerOptions
      ? { providerOptions: resolved.providerOptions }
      : {}),
  };
}
