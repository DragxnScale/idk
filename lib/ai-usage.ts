import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, aiUsageLogs } from "@/lib/db/schema";
import { randomUUID } from "crypto";
import { MODEL } from "@/lib/ai";

/**
 * Fallback AI token budget used when a user has no per-user limit set
 * (`users.aiTokenLimit IS NULL`). Override at deploy time via the
 * `AI_TOKEN_LIMIT_DEFAULT` env var. Set to `0` (or any negative) to mean
 * "unlimited" — useful for local dev where you don't want to babysit a quota.
 *
 * Defaults to 500k tokens per user — roughly 100-200 notes calls or a
 * couple dozen quiz/velocity generations with room to spare.
 */
const DEFAULT_LIMIT_ENV = process.env.AI_TOKEN_LIMIT_DEFAULT;
const DEFAULT_AI_TOKEN_LIMIT: number =
  DEFAULT_LIMIT_ENV != null && DEFAULT_LIMIT_ENV !== "" && Number.isFinite(Number(DEFAULT_LIMIT_ENV))
    ? Number(DEFAULT_LIMIT_ENV)
    : 500_000;

/** Represents the effective token-quota state for a single user. */
export interface AiTokenStatus {
  /** Lifetime total of prompt + completion tokens across every AI call. */
  used: number;
  /**
   * Effective per-user cap in tokens. `null` means no cap is enforced
   * (user had `aiTokenLimit = 0` AND the default is 0/negative, or both).
   */
  limit: number | null;
  /** `limit - used`, or `null` when unlimited. Can go negative after overshoot. */
  remaining: number | null;
  /** `true` when used >= limit (and a limit is set). */
  overBudget: boolean;
}

/** Resolve the effective limit for a user: their explicit override, else the default. */
function resolveLimit(userLimit: number | null | undefined): number | null {
  if (typeof userLimit === "number" && userLimit > 0) return userLimit;
  if (DEFAULT_AI_TOKEN_LIMIT > 0) return DEFAULT_AI_TOKEN_LIMIT;
  return null;
}

/**
 * Read a user's current AI token usage + limit. Returns `null` when the
 * user id doesn't match any row (caller should 401/404).
 */
export async function getAiTokenStatus(userId: string): Promise<AiTokenStatus | null> {
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { aiTokensUsed: true, aiTokenLimit: true },
  });
  if (!row) return null;
  const used = row.aiTokensUsed ?? 0;
  const limit = resolveLimit(row.aiTokenLimit);
  const remaining = limit == null ? null : limit - used;
  const overBudget = limit != null && used >= limit;
  return { used, limit, remaining, overBudget };
}

/**
 * Check before an AI call. If the user is already over their token budget,
 * returns a ready-to-return 429 NextResponse. Otherwise returns `null` and
 * the caller should proceed. Callers should still `recordAiUsage` after the
 * AI call so the counter stays accurate.
 *
 * ```ts
 * const overBudget = await assertAiBudget(user.id);
 * if (overBudget) return overBudget;
 * ```
 */
export async function assertAiBudget(userId: string): Promise<NextResponse | null> {
  const status = await getAiTokenStatus(userId);
  if (!status) return null;
  if (!status.overBudget) return null;
  return NextResponse.json(
    {
      error: "AI token limit reached",
      detail: `You've used ${status.used.toLocaleString()} of your ${status.limit?.toLocaleString() ?? "unlimited"} AI token allowance. Contact an admin to increase the limit.`,
      used: status.used,
      limit: status.limit,
    },
    { status: 429 }
  );
}

/** Shape of the `.usage` object returned by `ai` SDK's `generateText` /
 *  `generateObject`. We accept both the current field names (`inputTokens` /
 *  `outputTokens`) and the older ones (`promptTokens` / `completionTokens`)
 *  so an SDK bump doesn't break accounting.
 */
export interface AiUsageShape {
  promptTokens?: number;
  completionTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

function normaliseUsage(usage: AiUsageShape | undefined | null): {
  prompt: number;
  completion: number;
  total: number;
} {
  if (!usage) return { prompt: 0, completion: 0, total: 0 };
  const prompt = usage.promptTokens ?? usage.inputTokens ?? 0;
  const completion = usage.completionTokens ?? usage.outputTokens ?? 0;
  const total = usage.totalTokens ?? prompt + completion;
  return {
    prompt: Number.isFinite(prompt) ? prompt : 0,
    completion: Number.isFinite(completion) ? completion : 0,
    total: Number.isFinite(total) ? total : 0,
  };
}

/**
 * Record an AI call's token cost. Writes a per-call row to `ai_usage_logs`
 * AND bumps the denormalised `users.aiTokensUsed` counter.
 *
 * Swallows all errors — an accounting write failing should never stop the
 * AI response from reaching the user. The admin dashboard will just miss
 * that one call; the next successful call picks accounting back up.
 */
export async function recordAiUsage(
  userId: string,
  route: string,
  usage: AiUsageShape | undefined | null,
  model: string = MODEL
): Promise<void> {
  const { prompt, completion, total } = normaliseUsage(usage);
  if (total <= 0) return;
  try {
    await db.insert(aiUsageLogs).values({
      id: randomUUID(),
      userId,
      route,
      model,
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: total,
      createdAt: new Date(),
    });
    await db
      .update(users)
      .set({ aiTokensUsed: sql`COALESCE(${users.aiTokensUsed}, 0) + ${total}` })
      .where(eq(users.id, userId));
  } catch (err) {
    // Deliberately non-fatal. Log for dev diagnostics but don't throw.
    // eslint-disable-next-line no-console
    console.error("[ai-usage] failed to record usage", { userId, route, err });
  }
}

/** Exposed so admin UI can show "N/A (unlimited)" copy when appropriate. */
export function getDefaultAiTokenLimit(): number | null {
  return DEFAULT_AI_TOKEN_LIMIT > 0 ? DEFAULT_AI_TOKEN_LIMIT : null;
}
