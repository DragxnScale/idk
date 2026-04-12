import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";

const AI_OWNER_STYLE_KEY = "ai_owner_style";

export async function getAiOwnerStyleExtra(): Promise<string> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, AI_OWNER_STYLE_KEY),
  });
  return (row?.value ?? "").trim();
}

export async function setAiOwnerStyleExtra(value: string): Promise<void> {
  const trimmed = value.trim();
  const now = new Date();
  const existing = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, AI_OWNER_STYLE_KEY),
  });
  if (existing) {
    await db
      .update(appSettings)
      .set({ value: trimmed, updatedAt: now })
      .where(eq(appSettings.key, AI_OWNER_STYLE_KEY));
  } else {
    await db.insert(appSettings).values({
      key: AI_OWNER_STYLE_KEY,
      value: trimmed,
      updatedAt: now,
    });
  }
}

export function appendOwnerStyleToSystem(base: string, extra: string): string {
  if (!extra) return base;
  return `${base}\n\n---\nApp owner style / instructions (apply to all outputs):\n${extra}`;
}
