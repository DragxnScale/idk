import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { aiUsageLogs } from "@/lib/db/schema";
import {
  AI_USAGE_SECTIONS,
  sectionForRoute,
  subRouteLabel,
} from "@/lib/ai-route-sections";

const DEFAULT_PER_SECTION = 10;
const MAX_PER_SECTION = 25;

function mapLogRow(row: typeof aiUsageLogs.$inferSelect) {
  return {
    id: row.id,
    route: row.route,
    subRouteLabel: subRouteLabel(row.route),
    model: row.model ?? null,
    promptTokens: row.promptTokens ?? 0,
    completionTokens: row.completionTokens ?? 0,
    totalTokens: row.totalTokens ?? 0,
    createdAt: row.createdAt?.toISOString() ?? null,
    inputText: row.inputText ?? null,
    outputText: row.outputText ?? null,
  };
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const sectionFilter = searchParams.get("section");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const perPage = Math.min(
      MAX_PER_SECTION,
      Math.max(1, parseInt(searchParams.get("limit") ?? String(DEFAULT_PER_SECTION), 10) || DEFAULT_PER_SECTION)
    );

    const rows = await db
      .select()
      .from(aiUsageLogs)
      .where(eq(aiUsageLogs.userId, params.id))
      .orderBy(desc(aiUsageLogs.createdAt));

    const totalCalls = rows.length;
    const totalTokens = rows.reduce((s, r) => s + (r.totalTokens ?? 0), 0);

    const bySection = new Map<string, typeof rows>();
    for (const row of rows) {
      const sid = sectionForRoute(row.route);
      const list = bySection.get(sid) ?? [];
      list.push(row);
      bySection.set(sid, list);
    }

    const sectionsToRender = sectionFilter
      ? AI_USAGE_SECTIONS.filter((s) => s.id === sectionFilter)
      : AI_USAGE_SECTIONS;

    const sections = sectionsToRender
      .map((def) => {
        const sectionRows = bySection.get(def.id) ?? [];
        if (sectionRows.length === 0 && !sectionFilter) return null;

        const sectionTotalTokens = sectionRows.reduce((s, r) => s + (r.totalTokens ?? 0), 0);
        const start = (page - 1) * perPage;
        const slice = sectionFilter
          ? sectionRows.slice(start, start + perPage)
          : sectionRows.slice(0, perPage);
        const hasMore = sectionFilter
          ? sectionRows.length > start + perPage
          : sectionRows.length > perPage;

        return {
          id: def.id,
          label: def.label,
          routes: [...def.routes],
          totalTokens: sectionTotalTokens,
          callCount: sectionRows.length,
          logs: slice.map(mapLogRow),
          hasMore,
          page: sectionFilter ? page : 1,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s != null && s.callCount > 0);

    return NextResponse.json({
      totalCalls,
      totalTokens,
      sections,
    });
  } catch (err) {
    console.error("[admin/ai-usage]", err);
    return NextResponse.json({ error: "Failed to load AI usage" }, { status: 500 });
  }
}
