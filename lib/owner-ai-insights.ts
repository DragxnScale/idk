import { desc, gte, sql } from "drizzle-orm";
import { fetchAiContentCounts } from "@/lib/ai-content-counts";
import { previewText } from "@/lib/ai-content-source";
import { AI_USAGE_SECTIONS, sectionForRoute } from "@/lib/ai-route-sections";
import { db } from "@/lib/db";
import { aiUsageLogs, clientErrorLogs, velocityQuestionBank } from "@/lib/db/schema";

const SAMPLES_PER_SECTION = 2;
const TEXT_SAMPLE_CHARS = 400;
const MAX_VELOCITY_REPORTS = 8;
const MAX_CLIENT_ERRORS = 5;
const MAX_INSIGHTS_JSON_CHARS = 12_000;
const USAGE_WINDOW_DAYS = 30;

export interface OwnerAiUsageSample {
  route: string;
  createdAt: string | null;
  totalTokens: number;
  inputPreview: string | null;
  outputPreview: string | null;
}

export interface OwnerAiUsageSectionInsight {
  id: string;
  label: string;
  callCount30d: number;
  totalTokens30d: number;
  samples: OwnerAiUsageSample[];
}

export interface OwnerAiVelocityReport {
  id: string;
  topic: string | null;
  reportCount: number;
  lastReportReason: string | null;
  questionPreview: string | null;
}

export interface OwnerAiClientErrorSample {
  createdAt: string | null;
  url: string | null;
  message: string;
}

export interface OwnerAiInsights {
  contentCounts: Awaited<ReturnType<typeof fetchAiContentCounts>>;
  usageSections: OwnerAiUsageSectionInsight[];
  velocityReports: OwnerAiVelocityReport[];
  reportedVelocityCount: number;
  clientErrors: OwnerAiClientErrorSample[];
}

export interface OwnerAiInsightsSummary {
  contentCounts: OwnerAiInsights["contentCounts"];
  usageTotals30d: { callCount: number; totalTokens: number };
  reportedVelocityCount: number;
  clientErrorCount: number;
}

function truncateText(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function thirtyDaysAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - USAGE_WINDOW_DAYS);
  return d;
}

async function fetchUsageInsights(): Promise<OwnerAiUsageSectionInsight[]> {
  const since = thirtyDaysAgo();
  const rows = await db
    .select()
    .from(aiUsageLogs)
    .where(gte(aiUsageLogs.createdAt, since))
    .orderBy(desc(aiUsageLogs.createdAt));

  const bySection = new Map<string, typeof rows>();
  const totals = new Map<string, { callCount: number; totalTokens: number }>();

  for (const row of rows) {
    const sid = sectionForRoute(row.route);
    const list = bySection.get(sid) ?? [];
    list.push(row);
    bySection.set(sid, list);

    const t = totals.get(sid) ?? { callCount: 0, totalTokens: 0 };
    t.callCount += 1;
    t.totalTokens += row.totalTokens ?? 0;
    totals.set(sid, t);
  }

  return AI_USAGE_SECTIONS.map((def) => {
    const sectionRows = bySection.get(def.id) ?? [];
    const total = totals.get(def.id) ?? { callCount: 0, totalTokens: 0 };
    const samples = sectionRows.slice(0, SAMPLES_PER_SECTION).map((row) => ({
      route: row.route,
      createdAt: row.createdAt?.toISOString() ?? null,
      totalTokens: row.totalTokens ?? 0,
      inputPreview: truncateText(row.inputText, TEXT_SAMPLE_CHARS),
      outputPreview: truncateText(row.outputText, TEXT_SAMPLE_CHARS),
    }));

    return {
      id: def.id,
      label: def.label,
      callCount30d: total.callCount,
      totalTokens30d: total.totalTokens,
      samples,
    };
  }).filter((s) => s.callCount30d > 0 || s.samples.length > 0);
}

async function fetchVelocityReports(): Promise<{
  reports: OwnerAiVelocityReport[];
  reportedCount: number;
}> {
  const reportedRows = await db
    .select()
    .from(velocityQuestionBank)
    .where(sql`${velocityQuestionBank.reportCount} > 0`)
    .orderBy(desc(velocityQuestionBank.reportCount))
    .limit(MAX_VELOCITY_REPORTS);

  const countRes = await db
    .select({ n: sql<number>`count(*)` })
    .from(velocityQuestionBank)
    .where(sql`${velocityQuestionBank.reportCount} > 0`);

  const reports: OwnerAiVelocityReport[] = reportedRows.map((row) => {
    let questionPreview: string | null = null;
    try {
      const q = JSON.parse(row.questionJson) as {
        question?: string;
        prompt?: string;
      };
      const raw = q.question ?? q.prompt ?? null;
      questionPreview = raw ? previewText(raw, 200) : null;
    } catch {
      questionPreview = null;
    }
    return {
      id: row.id,
      topic: row.topic,
      reportCount: row.reportCount,
      lastReportReason: truncateText(row.lastReportReason, 300),
      questionPreview,
    };
  });

  return {
    reports,
    reportedCount: Number(countRes[0]?.n ?? 0),
  };
}

async function fetchAiClientErrors(): Promise<OwnerAiClientErrorSample[]> {
  const rows = await db
    .select()
    .from(clientErrorLogs)
    .where(
      sql`${clientErrorLogs.kind} = 'user' AND ${clientErrorLogs.url} LIKE '%/api/ai/%'`
    )
    .orderBy(desc(clientErrorLogs.createdAt))
    .limit(MAX_CLIENT_ERRORS);

  return rows.map((row) => ({
    createdAt: row.createdAt?.toISOString() ?? null,
    url: row.url,
    message: truncateText(row.message, 300) ?? "",
  }));
}

export async function gatherOwnerAiInsights(): Promise<OwnerAiInsights> {
  const [contentCounts, usageSections, velocity, clientErrors] = await Promise.all([
    fetchAiContentCounts(),
    fetchUsageInsights(),
    fetchVelocityReports(),
    fetchAiClientErrors(),
  ]);

  return {
    contentCounts,
    usageSections,
    velocityReports: velocity.reports,
    reportedVelocityCount: velocity.reportedCount,
    clientErrors,
  };
}

export function buildInsightsSummary(insights: OwnerAiInsights): OwnerAiInsightsSummary {
  const usageTotals30d = insights.usageSections.reduce(
    (acc, s) => ({
      callCount: acc.callCount + s.callCount30d,
      totalTokens: acc.totalTokens + s.totalTokens30d,
    }),
    { callCount: 0, totalTokens: 0 }
  );

  return {
    contentCounts: insights.contentCounts,
    usageTotals30d,
    reportedVelocityCount: insights.reportedVelocityCount,
    clientErrorCount: insights.clientErrors.length,
  };
}

function capInsightsJson(insights: OwnerAiInsights): string {
  let payload = JSON.stringify(insights, null, 2);
  if (payload.length <= MAX_INSIGHTS_JSON_CHARS) return payload;

  const trimmed: OwnerAiInsights = {
    ...insights,
    usageSections: insights.usageSections.map((s) => ({
      ...s,
      samples: s.samples.map((sample) => ({
        ...sample,
        inputPreview: truncateText(sample.inputPreview, 200),
        outputPreview: truncateText(sample.outputPreview, 200),
      })),
    })),
    velocityReports: insights.velocityReports.slice(0, 5),
    clientErrors: insights.clientErrors.slice(0, 3),
  };
  payload = JSON.stringify(trimmed, null, 2);
  if (payload.length <= MAX_INSIGHTS_JSON_CHARS) return payload;

  return `${payload.slice(0, MAX_INSIGHTS_JSON_CHARS)}\n\n[truncated for token budget]`;
}

export function formatInsightsForAnalysis(insights: OwnerAiInsights): string {
  const summary = buildInsightsSummary(insights);
  const sectionLines = insights.usageSections
    .map(
      (s) =>
        `- ${s.label}: ${s.callCount30d} calls, ${s.totalTokens30d} tokens (30d); ${s.samples.length} sample(s)`
    )
    .join("\n");

  return `Analyze the following Bowl Beacon production snapshot and suggest improvements to owner-editable AI prompt settings (ai_product_context, ai_owner_style, and per-feature extras).

Focus on:
- Output quality patterns in usage samples (too verbose, weak distractors, factual issues)
- Velocity questions users reported as bad
- Volume signals from content counts (underused vs over-cached features)
- Any client errors on AI routes

Respond with 3–6 concise bullet points of findings, then include an owner_ai_proposal JSON block if specific setting changes are warranted. If data is sparse, say so and suggest what to monitor.

--- SUMMARY ---
Content counts: ${JSON.stringify(summary.contentCounts)}
30-day AI usage: ${summary.usageTotals30d.callCount} calls, ${summary.usageTotals30d.totalTokens} tokens
Velocity bank questions with reports: ${summary.reportedVelocityCount}
Recent AI-route client errors sampled: ${summary.clientErrorCount}

--- USAGE BY SECTION (30d) ---
${sectionLines || "(no usage in last 30 days)"}

--- FULL SNAPSHOT (JSON) ---
${capInsightsJson(insights)}`;
}
