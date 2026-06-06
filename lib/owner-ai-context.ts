import { readFileSync } from "fs";
import { join } from "path";
import { UNTRUSTED_INPUT_GUARD } from "@/lib/ai";
import type { OwnerAiSettings } from "@/lib/owner-ai-settings-shared";

const CONTEXT_PATH = join(process.cwd(), "docs", "AI_OWNER_CONTEXT.md");
const MAX_CONTEXT_CHARS = 12_000;

let cachedContext: string | null = null;

export function loadOwnerAiContextDoc(): string {
  if (cachedContext !== null) return cachedContext;
  try {
    const raw = readFileSync(CONTEXT_PATH, "utf8");
    cachedContext =
      raw.length > MAX_CONTEXT_CHARS
        ? `${raw.slice(0, MAX_CONTEXT_CHARS)}\n\n[…truncated]`
        : raw;
    return cachedContext;
  } catch {
    cachedContext =
      "Bowl Beacon is a study app with AI notes, quiz, flashcards, velocity, and videos. See docs/ARCHITECTURE.md for details.";
    return cachedContext;
  }
}

export function formatSettingsSnapshot(settings: OwnerAiSettings): string {
  const lines = [
    `ai_product_context (${settings.aiProductContext.length} chars):`,
    settings.aiProductContext || "(empty)",
    "",
    `ai_owner_style (${settings.aiOwnerStyle.length} chars):`,
    settings.aiOwnerStyle || "(empty)",
    "",
    `ai_notes_extra: ${settings.aiNotesExtra || "(empty)"}`,
    `ai_quiz_extra: ${settings.aiQuizExtra || "(empty)"}`,
    `ai_flashcards_extra: ${settings.aiFlashcardsExtra || "(empty)"}`,
    `ai_velocity_extra: ${settings.aiVelocityExtra || "(empty)"}`,
    `ai_videos_extra: ${settings.aiVideosExtra || "(empty)"}`,
  ];
  return lines.join("\n");
}

export function buildOwnerChatSystemPrompt(settings: OwnerAiSettings): string {
  const contextDoc = loadOwnerAiContextDoc();
  const settingsBlock = formatSettingsSnapshot(settings);

  return `You are the internal Bowl Beacon AI architect assistant for the project super-owner.

Your job:
- Explain how AI features, caches, and admin tools work using the context below.
- Suggest concrete refinements to owner-editable prompt settings (not TypeScript code unless the owner asks for a deploy plan).
- When proposing settings changes, include a machine-parseable JSON block on its own line:

{"type":"owner_ai_proposal","patches":{"ai_owner_style":"..."},"summary":"Short description"}

Allowed patch keys only: ai_product_context, ai_owner_style, ai_notes_extra, ai_quiz_extra, ai_flashcards_extra, ai_velocity_extra, ai_videos_extra.
Put the full new text for each key in patches (not a diff). The owner must click Apply in the UI; never claim settings are already saved.

--- PRODUCT & AI CONTEXT ---
${contextDoc}

--- CURRENT OWNER AI SETTINGS ---
${settingsBlock}
${UNTRUSTED_INPUT_GUARD}`;
}
