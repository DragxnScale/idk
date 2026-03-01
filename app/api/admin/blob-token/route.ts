import {
  generateClientTokenFromReadWriteToken,
  type HandleUploadBody,
} from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireAdminEdge } from "@/lib/admin-edge";

// Edge runtime: fast cold starts, no DB dependency, no timeout issues.
export const runtime = "edge";

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody;

  // Short-circuit completion callbacks immediately.
  if (body.type === "blob.upload-completed") {
    return NextResponse.json({ type: "blob.upload-completed", response: "ok" });
  }

  // Admin check via JWT (no DB needed on Edge).
  const session = await requireAdminEdge(request);
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (body.type !== "blob.generate-client-token") {
    return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
  }

  const { pathname } = body.payload;
  const callbackUrl = new URL("/api/admin/blob-token", request.url).toString();

  try {
    const clientToken = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN!,
      pathname,
      allowedContentTypes: ["application/pdf"],
      maximumSizeInBytes: 500 * 1024 * 1024,
      validUntil: Date.now() + 2 * 60 * 60 * 1000, // 2 hours
      onUploadCompleted: { callbackUrl },
    });

    return NextResponse.json({
      type: "blob.generate-client-token",
      clientToken,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 }
    );
  }
}
