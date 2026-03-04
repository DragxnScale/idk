import {
  createMultipartUpload,
  uploadPart,
  completeMultipartUpload,
} from "@vercel/blob";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const maxDuration = 120;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  if (action === "create") {
    const pathname = searchParams.get("pathname");
    if (!pathname) {
      return NextResponse.json({ error: "pathname required" }, { status: 400 });
    }

    try {
      const mpu = await createMultipartUpload(pathname, {
        access: "private",
        contentType: "application/pdf",
      });
      return NextResponse.json({
        uploadId: mpu.uploadId,
        key: mpu.key,
      });
    } catch (e) {
      console.error("[multipart] create error:", e);
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (action === "upload-part") {
    const uploadId = searchParams.get("uploadId");
    const key = searchParams.get("key");
    const partNumber = Number(searchParams.get("partNumber"));
    if (!uploadId || !key || !partNumber) {
      return NextResponse.json({ error: "uploadId, key, partNumber required" }, { status: 400 });
    }

    if (!request.body) {
      return NextResponse.json({ error: "No body" }, { status: 400 });
    }

    try {
      const part = await uploadPart(key, request.body, {
        access: "private",
        uploadId,
        key,
        partNumber,
      });
      return NextResponse.json({ etag: part.etag, partNumber: part.partNumber });
    } catch (e) {
      console.error("[multipart] upload-part error:", e);
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (action === "complete") {
    const uploadId = searchParams.get("uploadId");
    const key = searchParams.get("key");
    if (!uploadId || !key) {
      return NextResponse.json({ error: "uploadId, key required" }, { status: 400 });
    }

    let parts: { etag: string; partNumber: number }[];
    try {
      const body = await request.json();
      parts = body.parts;
    } catch {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    try {
      const blob = await completeMultipartUpload(key, parts, { access: "private", uploadId, key });
      return NextResponse.json({ url: blob.url, pathname: blob.pathname });
    } catch (e) {
      console.error("[multipart] complete error:", e);
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
