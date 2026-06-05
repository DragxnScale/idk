/**
 * Helpers for resolving the human-readable title of a flashcard "deck"
 * on the /review surface.
 *
 * A deck corresponds to a `textbook_catalog` row, a `documents` row, or
 * (when both joins fail) a synthetic "untitled" bucket. The SQL joins
 * in `/api/review/decks` and `/api/review/queue` already prefer the
 * catalog title over the per-user document title; this module adds a
 * THIRD fallback: when both DB joins miss, parse the originating
 * session's `study_sessions.document_json` blob and pull `title`
 * (the chapter-range label baked at session-start) or `catalogTitle`
 * out of it.
 *
 * Why this matters: early users' first review sessions sometimes have
 * no `session_content` row (e.g. the session was started with an ad-hoc
 * document that never got upserted into `documents`), so without the
 * document_json fallback the user just sees "Untitled deck" forever.
 */

interface SessionDocumentJson {
  title?: unknown;
  catalogTitle?: unknown;
  originalName?: unknown;
}

/**
 * Extracts a display title from a raw `study_sessions.document_json`
 * string. Returns null when the JSON is missing/invalid or doesn't
 * contain any of the recognised title fields.
 */
export function titleFromSessionDocumentJson(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let parsed: SessionDocumentJson;
  try {
    parsed = JSON.parse(raw) as SessionDocumentJson;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidates: unknown[] = [parsed.title, parsed.catalogTitle, parsed.originalName];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/**
 * Resolve the deck title shown in the UI. The priority is:
 *   1. The DB-derived title (already coalesces `tc.title → d.title`).
 *   2. The session's `document_json` (parsed via
 *      {@link titleFromSessionDocumentJson}).
 *   3. The literal string "Untitled deck".
 */
export function resolveDeckTitle(
  dbTitle: string | null | undefined,
  documentJson: string | null | undefined,
): string {
  if (dbTitle && dbTitle.trim()) return dbTitle.trim();
  const fromJson = titleFromSessionDocumentJson(documentJson);
  if (fromJson) return fromJson;
  return "Untitled deck";
}
