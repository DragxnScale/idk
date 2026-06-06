import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { UNTRUSTED_INPUT_GUARD } from "@/lib/ai";
import {
  OWNER_AI_SETTING_KEYS,
  OWNER_AI_SETTING_MAX,
  type AiPromptFeature,
  type OwnerAiSettingKey,
  type OwnerAiSettings,
  type OwnerAiSettingsPatch,
} from "@/lib/owner-ai-settings-shared";

export {
  OWNER_AI_SETTING_KEYS,
  OWNER_AI_SETTING_MAX,
  type AiPromptFeature,
  type OwnerAiSettingKey,
  type OwnerAiSettings,
  type OwnerAiSettingsPatch,
} from "@/lib/owner-ai-settings-shared";

const KEY_TO_FIELD: Record<OwnerAiSettingKey, keyof OwnerAiSettings> = {
  ai_owner_style: "aiOwnerStyle",
  ai_product_context: "aiProductContext",
  ai_notes_extra: "aiNotesExtra",
  ai_quiz_extra: "aiQuizExtra",
  ai_flashcards_extra: "aiFlashcardsExtra",
  ai_velocity_extra: "aiVelocityExtra",
  ai_videos_extra: "aiVideosExtra",
};

const FIELD_TO_KEY: Record<keyof OwnerAiSettings, OwnerAiSettingKey> = {
  aiOwnerStyle: "ai_owner_style",
  aiProductContext: "ai_product_context",
  aiNotesExtra: "ai_notes_extra",
  aiQuizExtra: "ai_quiz_extra",
  aiFlashcardsExtra: "ai_flashcards_extra",
  aiVelocityExtra: "ai_velocity_extra",
  aiVideosExtra: "ai_videos_extra",
};

const EMPTY_SETTINGS: OwnerAiSettings = {
  aiOwnerStyle: "",
  aiProductContext: "",
  aiNotesExtra: "",
  aiQuizExtra: "",
  aiFlashcardsExtra: "",
  aiVelocityExtra: "",
  aiVideosExtra: "",
};

function isOwnerAiSettingKey(key: string): key is OwnerAiSettingKey {
  return key in OWNER_AI_SETTING_MAX;
}

async function upsertSetting(key: OwnerAiSettingKey, value: string): Promise<void> {
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

export async function getOwnerAiSettings(): Promise<OwnerAiSettings> {
  const keys = Object.values(OWNER_AI_SETTING_KEYS);
  const rows = await db.query.appSettings.findMany({
    where: inArray(appSettings.key, keys),
  });
  const out = { ...EMPTY_SETTINGS };
  for (const row of rows) {
    if (!isOwnerAiSettingKey(row.key)) continue;
    const field = KEY_TO_FIELD[row.key];
    out[field] = (row.value ?? "").trim();
  }
  return out;
}

export function validateOwnerAiPatches(
  patches: Record<string, string>
): { ok: true } | { ok: false; error: string } {
  for (const [key, value] of Object.entries(patches)) {
    if (!isOwnerAiSettingKey(key)) {
      return { ok: false, error: `Unknown setting key: ${key}` };
    }
    if (value.length > OWNER_AI_SETTING_MAX[key]) {
      return {
        ok: false,
        error: `${key} must be ${OWNER_AI_SETTING_MAX[key]} characters or less`,
      };
    }
  }
  return { ok: true };
}

/** Patch by DB keys (snake_case) or camelCase OwnerAiSettings fields. */
export async function patchOwnerAiSettings(
  patches: Record<string, string>
): Promise<OwnerAiSettings> {
  const normalized: Record<OwnerAiSettingKey, string> = {} as Record<
    OwnerAiSettingKey,
    string
  >;

  for (const [key, raw] of Object.entries(patches)) {
    let dbKey: OwnerAiSettingKey | undefined;
    if (isOwnerAiSettingKey(key)) {
      dbKey = key;
    } else if (key in FIELD_TO_KEY) {
      dbKey = FIELD_TO_KEY[key as keyof OwnerAiSettings];
    }
    if (!dbKey) continue;
    normalized[dbKey] = raw.trim();
  }

  const validation = validateOwnerAiPatches(normalized);
  if (!validation.ok) throw new Error(validation.error);

  for (const [key, value] of Object.entries(normalized)) {
    await upsertSetting(key as OwnerAiSettingKey, value);
  }

  return getOwnerAiSettings();
}

export async function patchOwnerAiSettingsFromFields(
  patch: OwnerAiSettingsPatch
): Promise<OwnerAiSettings> {
  const dbPatch: Record<string, string> = {};
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!(field in FIELD_TO_KEY)) continue;
    dbPatch[FIELD_TO_KEY[field as keyof OwnerAiSettings]] = value;
  }
  return patchOwnerAiSettings(dbPatch);
}

export async function getAiOwnerStyleExtra(): Promise<string> {
  const s = await getOwnerAiSettings();
  return s.aiOwnerStyle;
}

export async function setAiOwnerStyleExtra(value: string): Promise<void> {
  await patchOwnerAiSettings({ ai_owner_style: value.trim() });
}

export function appendOwnerStyleToSystem(base: string, extra: string): string {
  if (!extra) return base;
  return `${base}\n\n---\nApp owner style / instructions (apply to all outputs):\n${extra}`;
}

function featureExtraField(
  feature: AiPromptFeature
): keyof OwnerAiSettings | null {
  switch (feature) {
    case "notes":
      return "aiNotesExtra";
    case "quiz":
      return "aiQuizExtra";
    case "flashcards":
      return "aiFlashcardsExtra";
    case "velocity":
      return "aiVelocityExtra";
    case "videos":
      return "aiVideosExtra";
    case "global":
      return null;
  }
}

export async function getAiPromptExtras(feature: AiPromptFeature): Promise<{
  productContext: string;
  globalStyle: string;
  featureExtra: string;
  composedAppend: string;
}> {
  const settings = await getOwnerAiSettings();
  const field = featureExtraField(feature);
  const featureExtra = field ? settings[field] : "";
  const parts: string[] = [];
  if (settings.aiProductContext) {
    parts.push(
      `---\nProduct context (from app owner):\n${settings.aiProductContext}`
    );
  }
  if (settings.aiOwnerStyle) {
    parts.push(
      `---\nApp owner style / instructions (apply to all outputs):\n${settings.aiOwnerStyle}`
    );
  }
  if (featureExtra) {
    parts.push(`---\nFeature-specific instructions (${feature}):\n${featureExtra}`);
  }
  const composedAppend = parts.join("\n\n");
  return {
    productContext: settings.aiProductContext,
    globalStyle: settings.aiOwnerStyle,
    featureExtra,
    composedAppend,
  };
}

/** Fact-check and other secondary prompts: product + global + feature extras without UNTRUSTED guard. */
export async function getAiOwnerExtrasForFeature(
  feature: AiPromptFeature
): Promise<string> {
  const { composedAppend } = await getAiPromptExtras(feature);
  return composedAppend;
}

export async function buildAiSystemPrompt(
  base: string,
  feature: AiPromptFeature
): Promise<string> {
  const { composedAppend } = await getAiPromptExtras(feature);
  let system = base;
  if (composedAppend) system = `${system}\n\n${composedAppend}`;
  return system + UNTRUSTED_INPUT_GUARD;
}
