import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

// Returns a short-lived Vercel Blob client token for the admin upload panel.
// Using a pre-generated token (instead of handleUploadUrl) means upload()
// resolves as soon as the file reaches the CDN — no completion callback,
// no retry loop, no hanging at 100%.
export async function GET(request: Request): Promise<Response> {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const pathname = searchParams.get("pathname");
  if (!pathname) {
    return NextResponse.json({ error: "pathname is required" }, { status: 400 });
  }

  // 30-minute window to accommodate very large PDFs on slow connections.
  const validUntil = Date.now() + 30 * 60 * 1000;

  const clientToken = await generateClientTokenFromReadWriteToken({
    token: process.env.BLOB_READ_WRITE_TOKEN!,
    pathname,
    allowedContentTypes: ["application/pdf"],
    maximumSizeInBytes: 500 * 1024 * 1024,
    validUntil,
    // No onUploadCompleted → upload() resolves immediately after CDN transfer.
  });

  return NextResponse.json({ clientToken });
}
