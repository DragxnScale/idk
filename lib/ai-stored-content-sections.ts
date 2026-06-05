/**
 * Admin AI Content browser — persisted artifacts grouped by feature.
 * Excludes videos (session cache only) and non-persisted AI calls.
 */

export const AI_STORED_CONTENT_SECTIONS = [
  { id: "notes", label: "Notes" },
  { id: "quiz", label: "Quiz" },
  { id: "flashcards", label: "Flashcards" },
  { id: "velocity-games", label: "Velocity games" },
  { id: "velocity-bank", label: "Velocity bank" },
] as const;

export type AiStoredContentSectionId =
  (typeof AI_STORED_CONTENT_SECTIONS)[number]["id"];

export const DEFAULT_CONTENT_PAGE_SIZE = 20;
export const MAX_CONTENT_PAGE_SIZE = 50;

export function isValidContentSection(
  id: string | null
): id is AiStoredContentSectionId {
  return AI_STORED_CONTENT_SECTIONS.some((s) => s.id === id);
}

export function sectionLabel(id: AiStoredContentSectionId): string {
  return AI_STORED_CONTENT_SECTIONS.find((s) => s.id === id)?.label ?? id;
}
