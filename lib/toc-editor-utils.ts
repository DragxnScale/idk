export interface TocRow {
  label: string;
  startPage: number;
  endPage: number;
}

export function tocRowsToRanges(
  rows: TocRow[],
  offset: number
): Record<string, [number, number]> {
  const ranges: Record<string, [number, number]> = {};
  for (const row of rows) {
    if (!row.label.trim()) continue;
    if (row.startPage <= 0 || row.endPage <= 0 || row.endPage < row.startPage) continue;
    ranges[row.label.trim()] = [row.startPage + offset, row.endPage + offset];
  }
  return ranges;
}

export function rangesToTocRows(
  ranges: Record<string, [number, number]>,
  offset: number
): TocRow[] {
  return Object.entries(ranges)
    .sort(([, a], [, b]) => a[0] - b[0])
    .map(([label, [start, end]]) => ({
      label,
      startPage: start - offset,
      endPage: end - offset,
    }));
}

/** Next ascending chapter label (numeric when prior rows use numbers). */
export function nextChapterLabel(rows: TocRow[], afterIndex?: number): string {
  if (afterIndex !== undefined) {
    const following = rows[afterIndex + 1];
    const current = rows[afterIndex]?.label.trim();
    if (following && /^\d+$/.test(following.label.trim()) && /^\d+$/.test(current ?? "")) {
      return String(parseInt(following.label, 10));
    }
    if (/^\d+$/.test(current ?? "")) {
      return String(parseInt(current!, 10) + 1);
    }
    return String(afterIndex + 2);
  }

  const numeric = rows
    .map((r) => r.label.trim())
    .filter((l) => /^\d+$/.test(l))
    .map((l) => parseInt(l, 10));
  if (numeric.length > 0) {
    return String(Math.max(...numeric) + 1);
  }
  return String(rows.length + 1);
}

export function createDefaultTocRows(): TocRow[] {
  return [{ label: "1", startPage: 1, endPage: 0 }];
}

export function createNewTocRowAfter(rows: TocRow[], afterIndex?: number): TocRow {
  const ref = afterIndex !== undefined ? rows[afterIndex] : rows[rows.length - 1];
  const prevEnd = ref?.endPage || 0;
  return {
    label: nextChapterLabel(rows, afterIndex),
    startPage: prevEnd > 0 ? prevEnd + 1 : ref?.startPage || 1,
    endPage: 0,
  };
}

/** Book-page ranges for the editable JSON tab (no offset). */
export function tocRowsToBookRanges(rows: TocRow[]): Record<string, [number, number]> {
  const ranges: Record<string, [number, number]> = {};
  for (const row of rows) {
    if (!row.label.trim()) continue;
    if (row.startPage <= 0 || row.endPage <= 0 || row.endPage < row.startPage) continue;
    ranges[row.label.trim()] = [row.startPage, row.endPage];
  }
  return ranges;
}

export function bookRangesToTocRows(ranges: Record<string, [number, number]>): TocRow[] {
  return Object.entries(ranges)
    .sort(([, a], [, b]) => a[0] - b[0])
    .map(([label, [start, end]]) => ({
      label,
      startPage: start,
      endPage: end,
    }));
}

/** Final PDF ranges saved to chapterPageRanges (book + offset). */
export function finalPdfRanges(
  rows: TocRow[],
  offset: number
): Record<string, [number, number]> {
  return tocRowsToRanges(rows, offset);
}

export function parseTocRangesJson(json: string): Record<string, [number, number]> {
  const parsed = JSON.parse(json) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Must be an object");
  }
  for (const [k, v] of Object.entries(parsed)) {
    if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== "number" || typeof v[1] !== "number") {
      throw new Error(`Invalid range for "${k}"`);
    }
  }
  return parsed as Record<string, [number, number]>;
}
