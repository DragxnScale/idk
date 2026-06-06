/** Client-safe Owner AI settings types and keys (no DB imports). */

export const OWNER_AI_SETTING_KEYS = {
  aiOwnerStyle: "ai_owner_style",
  aiProductContext: "ai_product_context",
  aiNotesExtra: "ai_notes_extra",
  aiQuizExtra: "ai_quiz_extra",
  aiFlashcardsExtra: "ai_flashcards_extra",
  aiVelocityExtra: "ai_velocity_extra",
  aiVideosExtra: "ai_videos_extra",
} as const;

export type OwnerAiSettingKey =
  (typeof OWNER_AI_SETTING_KEYS)[keyof typeof OWNER_AI_SETTING_KEYS];

export const OWNER_AI_SETTING_MAX: Record<OwnerAiSettingKey, number> = {
  ai_owner_style: 8000,
  ai_product_context: 4000,
  ai_notes_extra: 4000,
  ai_quiz_extra: 4000,
  ai_flashcards_extra: 4000,
  ai_velocity_extra: 4000,
  ai_videos_extra: 4000,
};

export interface OwnerAiSettings {
  aiOwnerStyle: string;
  aiProductContext: string;
  aiNotesExtra: string;
  aiQuizExtra: string;
  aiFlashcardsExtra: string;
  aiVelocityExtra: string;
  aiVideosExtra: string;
}

export type OwnerAiSettingsPatch = Partial<OwnerAiSettings>;

export type AiPromptFeature =
  | "notes"
  | "quiz"
  | "flashcards"
  | "velocity"
  | "videos"
  | "global";
