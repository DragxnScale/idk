import { NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { users, documents } from "@/lib/db/schema";
import { effectiveQuota, formatBytes, DEFAULT_QUOTA_BYTES } from "@/lib/storage";

export async function GET() {
  const authUser = await getAppUser();
  if (!authUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Compute usage directly from documents table (accurate, never stale).
  // Only counts user uploads (sourceType = "upload") — excludes catalog imports.
  const [usageRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(file_size_bytes), 0)` })
    .from(documents)
    .where(
      and(
        eq(documents.userId, authUser.id),
        eq(documents.sourceType, "upload")
      )
    );

  const usedBytes = Number(usageRow?.total ?? 0);

  // Keep storageBytes in sync so quota checks in register() stay accurate
  await db
    .update(users)
    .set({ storageBytes: usedBytes })
    .where(eq(users.id, authUser.id));

  const row = await db.query.users.findFirst({
    where: eq(users.id, authUser.id),
    columns: { storageQuotaBytes: true },
  });

  const quotaBytes = effectiveQuota(row?.storageQuotaBytes);
  const pct = usedBytes === 0 ? 0 : Math.min(100, Math.round((usedBytes / quotaBytes) * 100));

  return NextResponse.json({
    usedBytes,
    quotaBytes,
    defaultQuotaBytes: DEFAULT_QUOTA_BYTES,
    pct,
    usedFormatted: formatBytes(usedBytes),
    quotaFormatted: formatBytes(quotaBytes),
  });
}
