import { NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { documents, users } from "@/lib/db/schema";
import { effectiveQuota } from "@/lib/storage";

// Called after a client-side Vercel Blob upload completes.
// Registers the document in the DB so it shows up in My Drive.
export async function POST(request: Request) {
  const authUser = await getAppUser();
  if (!authUser?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { title, fileUrl, fileSize } = await request.json() as {
    title?: string;
    fileUrl?: string;
    fileSize?: number;
  };

  if (!fileUrl) {
    return NextResponse.json({ error: "fileUrl required" }, { status: 400 });
  }

  const fileSizeBytes = typeof fileSize === "number" && fileSize > 0 ? fileSize : 0;

  // ── Quota check (compute live from DB, not stale counter) ────────────
  const row = await db.query.users.findFirst({
    where: eq(users.id, authUser.id),
    columns: { storageQuotaBytes: true },
  });

  const [usageRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(file_size_bytes), 0)` })
    .from(documents)
    .where(and(eq(documents.userId, authUser.id), eq(documents.sourceType, "upload")));

  const usedBytes = Number(usageRow?.total ?? 0);
  const quota = effectiveQuota(row?.storageQuotaBytes);

  if (fileSizeBytes > 0 && usedBytes + fileSizeBytes > quota) {
    return NextResponse.json(
      {
        error: `Storage limit reached. You are using ${Math.round(usedBytes / 1024 / 1024)} MB of your ${Math.round(quota / 1024 / 1024)} MB quota. Delete some files to free up space.`,
        code: "QUOTA_EXCEEDED",
      },
      { status: 413 }
    );
  }

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(documents).values({
    id,
    userId: authUser.id,
    title: title || "Untitled",
    sourceType: "upload",
    fileUrl,
    fileSizeBytes: fileSizeBytes || null,
    createdAt: now,
    updatedAt: now,
  });

  // ── Sync storageBytes to accurate DB sum ─────────────────────────────
  if (fileSizeBytes > 0) {
    const [newUsage] = await db
      .select({ total: sql<number>`COALESCE(SUM(file_size_bytes), 0)` })
      .from(documents)
      .where(and(eq(documents.userId, authUser.id), eq(documents.sourceType, "upload")));
    await db
      .update(users)
      .set({ storageBytes: Number(newUsage?.total ?? 0) })
      .where(eq(users.id, authUser.id));
  }

  return NextResponse.json({ id, title: title || "Untitled", fileUrl });
}
