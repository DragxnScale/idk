import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";

interface ProgressEntry {
  textbookCatalogId: string;
  title: string;
  sessions: number;
  totalMinutes: number;
  uniquePagesVisited: number;
  totalPages: number | null;
  progressPct: number | null;
  lastStudiedAt: string | null;
}

/** Derive the last PDF page number from a chapterPageRanges JSON string. */
function totalPagesFromRanges(rangesJson: string | null): number | null {
  if (!rangesJson) return null;
  try {
    const ranges: Record<string, [number, number]> = JSON.parse(rangesJson);
    let max = 0;
    for (const [, [, end]] of Object.entries(ranges)) {
      if (end > max) max = end;
    }
    return max > 0 ? max : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Load all completed sessions ──────────────────────────────────────
  const rows = await db.query.studySessions.findMany({
    where: (s, { and, eq, isNotNull }) =>
      and(eq(s.userId, user.id), isNotNull(s.endedAt)),
  });

  // ── Group by textbookCatalogId ───────────────────────────────────────
  const map = new Map<
    string,
    { title: string; sessions: number; totalMinutes: number; visitedPages: Set<number>; lastStudiedAt: Date | null }
  >();

  for (const row of rows) {
    if (!row.documentJson) continue;
    let doc: { type?: string; documentId?: string; title?: string } = {};
    try {
      doc = JSON.parse(row.documentJson);
    } catch {
      continue;
    }
    if (doc.type !== "textbook" || !doc.documentId) continue;

    const key = doc.documentId;
    const existing = map.get(key);
    const rowDate = row.startedAt ?? null;

    // Parse the stored page list; fall back to an empty set if not yet stored
    let pageSet: Set<number> = new Set();
    if (row.visitedPagesList) {
      try {
        const arr: number[] = JSON.parse(row.visitedPagesList);
        pageSet = new Set(arr);
      } catch { /* ignore */ }
    } else if (row.pagesVisited) {
      // Legacy rows without the list: we can't know which pages, so skip
      // contribution to the union (they'll just show 0 until re-studied).
    }

    if (existing) {
      existing.sessions += 1;
      existing.totalMinutes += row.totalFocusedMinutes ?? 0;
      pageSet.forEach((p) => existing.visitedPages.add(p));
      if (rowDate && (!existing.lastStudiedAt || rowDate > existing.lastStudiedAt)) {
        existing.lastStudiedAt = rowDate;
      }
    } else {
      map.set(key, {
        title: doc.title ?? "Untitled textbook",
        sessions: 1,
        totalMinutes: row.totalFocusedMinutes ?? 0,
        visitedPages: pageSet,
        lastStudiedAt: rowDate,
      });
    }
  }

  if (map.size === 0) {
    return NextResponse.json([]);
  }

  // ── Fetch catalog rows for total page counts ─────────────────────────
  const catalogIds = Array.from(map.keys());
  const catalogRows = await db.query.textbookCatalog.findMany({
    where: (t, { inArray }) => inArray(t.id, catalogIds),
  });
  const catalogMap = new Map(catalogRows.map((r) => [r.id, r]));

  // ── Build result ─────────────────────────────────────────────────────
  const result: ProgressEntry[] = Array.from(map.entries())
    .map(([id, data]) => {
      const catalog = catalogMap.get(id);
      const totalPages = catalog
        ? totalPagesFromRanges(catalog.chapterPageRanges ?? null)
        : null;
      const title = catalog?.title ?? data.title;

      return {
        textbookCatalogId: id,
        title,
        sessions: data.sessions,
        totalMinutes: data.totalMinutes,
        uniquePagesVisited: data.visitedPages.size,
        totalPages,
        progressPct:
          totalPages && totalPages > 0
            ? Math.min(100, Math.round((data.visitedPages.size / totalPages) * 100))
            : null,
        lastStudiedAt: data.lastStudiedAt?.toISOString() ?? null,
      };
    })
    .sort((a, b) => {
      if (!a.lastStudiedAt) return 1;
      if (!b.lastStudiedAt) return -1;
      return b.lastStudiedAt.localeCompare(a.lastStudiedAt);
    });

  return NextResponse.json(result);
}
