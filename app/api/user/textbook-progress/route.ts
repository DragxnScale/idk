import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

interface ProgressEntry {
  textbookCatalogId: string;
  title: string;
  sessions: number;
  totalMinutes: number;
  totalPagesVisited: number;
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
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Load all completed sessions ──────────────────────────────────────
  const rows = await db.query.studySessions.findMany({
    where: (s, { and, eq, isNotNull }) =>
      and(eq(s.userId, session.user.id), isNotNull(s.endedAt)),
  });

  // ── Group by textbookCatalogId ───────────────────────────────────────
  const map = new Map<
    string,
    { title: string; sessions: number; totalMinutes: number; totalPagesVisited: number; lastStudiedAt: Date | null }
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

    if (existing) {
      existing.sessions += 1;
      existing.totalMinutes += row.totalFocusedMinutes ?? 0;
      existing.totalPagesVisited += row.pagesVisited ?? 0;
      if (rowDate && (!existing.lastStudiedAt || rowDate > existing.lastStudiedAt)) {
        existing.lastStudiedAt = rowDate;
      }
    } else {
      map.set(key, {
        title: doc.title ?? "Untitled textbook",
        sessions: 1,
        totalMinutes: row.totalFocusedMinutes ?? 0,
        totalPagesVisited: row.pagesVisited ?? 0,
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
        totalPagesVisited: data.totalPagesVisited,
        totalPages,
        progressPct:
          totalPages && totalPages > 0
            ? Math.min(100, Math.round((data.totalPagesVisited / totalPages) * 100))
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
