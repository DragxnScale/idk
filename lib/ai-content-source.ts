import { titleFromSessionDocumentJson } from "@/lib/review-deck-title";

export type ContentSourceType = "catalog" | "upload" | "unknown";

export interface ContentSource {
  textbookTitle: string | null;
  sourceType: ContentSourceType;
  page: number | null;
  chapterOrSection: string | null;
  sessionLabel: string | null;
}

export function parseChapterRanges(
  json: string | null | undefined
): Record<string, [number, number]> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, [number, number]>;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Which TOC chapter contains this book page (inclusive range). */
export function chapterForPage(
  ranges: Record<string, [number, number]> | null,
  page: number | null | undefined
): string | null {
  if (!ranges || page == null) return null;
  for (const [name, [start, end]] of Object.entries(ranges)) {
    if (page >= start && page <= end) return name;
  }
  return null;
}

interface SessionSourceInput {
  catalogTitle: string | null;
  documentTitle: string | null;
  catalogId: string | null;
  documentId: string | null;
  catalogRangesJson: string | null;
  documentRangesJson: string | null;
  documentJson: string | null;
  page: number | null;
}

export function resolveSourceFromSession(input: SessionSourceInput): ContentSource {
  const textbookTitle =
    (input.catalogTitle?.trim() || null) ??
    (input.documentTitle?.trim() || null) ??
    titleFromSessionDocumentJson(input.documentJson);

  let sourceType: ContentSourceType = "unknown";
  if (input.catalogId) sourceType = "catalog";
  else if (input.documentId) sourceType = "upload";

  const sessionLabel = titleFromSessionDocumentJson(input.documentJson);
  const ranges =
    parseChapterRanges(input.catalogRangesJson) ??
    parseChapterRanges(input.documentRangesJson);
  const chapterOrSection =
    chapterForPage(ranges, input.page) ?? sessionLabel;

  return {
    textbookTitle,
    sourceType,
    page: input.page,
    chapterOrSection,
    sessionLabel,
  };
}

export function resolveSourceFromCatalog(
  catalogTitle: string | null,
  catalogRangesJson: string | null,
  page: number | null
): ContentSource {
  const ranges = parseChapterRanges(catalogRangesJson);
  return {
    textbookTitle: catalogTitle?.trim() || null,
    sourceType: "catalog",
    page,
    chapterOrSection: chapterForPage(ranges, page),
    sessionLabel: null,
  };
}

export function resolveSourceFromVelocityBank(
  sourceKey: string,
  catalogTitle: string | null,
  documentTitle: string | null,
  catalogRangesJson: string | null,
  documentRangesJson: string | null,
  pageIndex: number
): ContentSource {
  const page = pageIndex > 0 ? pageIndex : null;
  let sourceType: ContentSourceType = "unknown";
  if (sourceKey.startsWith("textbook:")) sourceType = "catalog";
  else if (sourceKey.startsWith("doc:")) sourceType = "upload";

  const textbookTitle = catalogTitle?.trim() || documentTitle?.trim() || null;
  const ranges =
    parseChapterRanges(catalogRangesJson) ??
    parseChapterRanges(documentRangesJson);

  return {
    textbookTitle,
    sourceType,
    page,
    chapterOrSection: chapterForPage(ranges, page),
    sessionLabel: null,
  };
}

export function previewText(text: string, max = 300): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}
