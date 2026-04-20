import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

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

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("[blob-upload-direct] BLOB_READ_WRITE_TOKEN is not set");
    return NextResponse.json(
      { error: "Storage not configured. Use the link paste option instead." },
      { status: 500 }
    );
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

    const blob = await put(pathname, request.body, {
      access: "public",
      contentType: "application/pdf",
      multipart: true,
    });

    console.log("[blob-upload-direct] blob created:", blob.url);

    const now = new Date();
    await db.insert(documents).values({
      id,
      userId: user.id,
      title,
      sourceType: "upload",
      fileUrl: blob.url,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({ id, title, fileUrl: blob.url });
  } catch (err) {
    console.error("[blob-upload-direct] error:", err);
    const msg = (err as Error).message || "Upload failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
