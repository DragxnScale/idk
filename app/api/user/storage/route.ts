import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { effectiveQuota, formatBytes, DEFAULT_QUOTA_BYTES } from "@/lib/storage";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { storageBytes: true, storageQuotaBytes: true },
  });

  const usedBytes = user?.storageBytes ?? 0;
  const quotaBytes = effectiveQuota(user?.storageQuotaBytes);
  const pct = Math.min(100, Math.round((usedBytes / quotaBytes) * 100));

  return NextResponse.json({
    usedBytes,
    quotaBytes,
    defaultQuotaBytes: DEFAULT_QUOTA_BYTES,
    pct,
    usedFormatted: formatBytes(usedBytes),
    quotaFormatted: formatBytes(quotaBytes),
  });
}
