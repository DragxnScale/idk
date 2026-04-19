import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, users } from "@/lib/db/schema";
import { effectiveQuota } from "@/lib/storage";

// Called after a client-side Vercel Blob upload completes.
// Registers the document in the DB so it shows up in My Drive.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
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

  // ── Quota check ──────────────────────────────────────────────────────
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { storageBytes: true, storageQuotaBytes: true },
  });

  const usedBytes = user?.storageBytes ?? 0;
  const quota = effectiveQuota(user?.storageQuotaBytes);

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
    userId: session.user.id,
    title: title || "Untitled",
    sourceType: "upload",
    fileUrl,
    fileSizeBytes: fileSizeBytes || null,
    createdAt: now,
    updatedAt: now,
  });

  // ── Update running storage total ─────────────────────────────────────
  if (fileSizeBytes > 0) {
    await db
      .update(users)
      .set({ storageBytes: sql`COALESCE(storage_bytes, 0) + ${fileSizeBytes}` })
      .where(eq(users.id, session.user.id));
  }

  return NextResponse.json({ id, title: title || "Untitled", fileUrl });
}
