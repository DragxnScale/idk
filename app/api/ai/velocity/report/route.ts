/**
 * POST /api/ai/velocity/report
 *
 * Lets a player flag a bad Velocity question — context-dependent,
 * factually wrong, references something not in the reading, etc. We
 * locate the question in `velocity_question_bank` by exact question
 * text and bump `report_count`.
 *
 * The bank query in `app/api/ai/velocity/route.ts` filters out rows
 * with `report_count >= BAD_QUESTION_REPORT_THRESHOLD`, so a reported
 * question stops being served to future users immediately.
 *
 * Idempotent on the client side — repeated reports from the same user
 * are allowed and just keep bumping the counter (we don't track which
 * users reported what, to keep the schema simple).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { velocityQuestionBank } from "@/lib/db/schema";

const bodySchema = z.object({
  /** Exact question text as displayed in the game. */
  question: z.string().min(3).max(2000),
  /** Free-form reason from the user. Truncated to 500 chars on save. */
  reason: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid body" },
      { status: 400 }
    );
  }

  const trimmedQ = body.question.trim().toLowerCase();

  // The bank stores the question inside a JSON blob, so we can't push the
  // text comparison into SQL without LIKE on the blob (slow + brittle).
  // Instead pull rows that *could* match (we use a substring of the
  // question to cheaply filter via LIKE) and then verify in JS. The bank
  // is small enough (~thousands of rows total) that this stays fast.
  const probe = trimmedQ.slice(0, 60);
  const candidates = await db.query.velocityQuestionBank.findMany({
    where: (b, { like }) => like(sql`lower(${b.questionJson})`, `%${probe}%`),
    limit: 50,
  });

  const target = candidates.find((row) => {
    try {
      const q = JSON.parse(row.questionJson) as { question?: string };
      return typeof q.question === "string" && q.question.trim().toLowerCase() === trimmedQ;
    } catch {
      return false;
    }
  });

  if (!target) {
    // Not in the bank — possibly an AI-generated question that wasn't
    // persisted (e.g. server hiccup mid-write). Treat as a soft success
    // so the player still gets confirmation feedback.
    return NextResponse.json({ ok: true, matched: false });
  }

  await db
    .update(velocityQuestionBank)
    .set({
      reportCount: sql`COALESCE(${velocityQuestionBank.reportCount}, 0) + 1`,
      lastReportReason: body.reason ? body.reason.slice(0, 500) : target.lastReportReason ?? null,
      firstReportedAt: target.firstReportedAt ?? new Date(),
    })
    .where(eq(velocityQuestionBank.id, target.id));

  return NextResponse.json({ ok: true, matched: true });
}
