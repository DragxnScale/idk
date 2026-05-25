import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { putPdf } from "@/lib/storage-backend";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  let user;
  try {
    user = await getAppUser();
  } catch (e) {
    console.error("[blob-upload-direct] auth() threw:", e);
    return NextResponse.json({ error: "Auth failed" }, { status: 500 });
  }

  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title") || "Untitled";
  const filename = searchParams.get("filename") || `${title}.pdf`;

  if (!request.body) {
    return NextResponse.json({ error: "No file body" }, { status: 400 });
  }

  try {
    const id = crypto.randomUUID();
    const pathname = `${user.id}/${id}/${filename}`;
    console.log("[blob-upload-direct] uploading", pathname);

    const stored = await putPdf(pathname, request.body, {
      contentType: "application/pdf",
    });

    console.log("[blob-upload-direct] stored:", stored.url);

    const now = new Date();
    await db.insert(documents).values({
      id,
      userId: user.id,
      title,
      sourceType: "upload",
      fileUrl: stored.url,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id, title, fileUrl: stored.url });
  } catch (err) {
    console.error("[blob-upload-direct] error:", err);
    const msg = (err as Error).message || "Upload failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
