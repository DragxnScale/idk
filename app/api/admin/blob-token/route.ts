import {
  generateClientTokenFromReadWriteToken,
  type HandleUploadBody,
} from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireAdminEdge } from "@/lib/admin-edge";

export const runtime = "edge";

// Health check — visit /api/admin/blob-token in the browser to verify
// the endpoint is reachable and env vars are set.
export async function GET() {
  const hasBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
  const hasSecret = !!process.env.NEXTAUTH_SECRET;
  return NextResponse.json({
    ok: hasBlob && hasSecret,
    BLOB_READ_WRITE_TOKEN: hasBlob ? "set" : "MISSING",
    NEXTAUTH_SECRET: hasSecret ? "set" : "MISSING",
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    let body: HandleUploadBody;
    try {
      body = (await request.json()) as HandleUploadBody;
    } catch (e) {
      return NextResponse.json(
        { error: `Failed to parse request body: ${(e as Error).message}` },
        { status: 400 }
      );
    }

    if (body.type === "blob.upload-completed") {
      return NextResponse.json({
        type: "blob.upload-completed",
        response: "ok",
      });
    }

    let session;
    try {
      session = await requireAdminEdge(request);
    } catch (e) {
      return NextResponse.json(
        { error: `Auth failed: ${(e as Error).message}` },
        { status: 500 }
      );
    }

    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (body.type !== "blob.generate-client-token") {
      return NextResponse.json(
        { error: `Invalid event type: ${(body as { type?: string }).type}` },
        { status: 400 }
      );
    }

    const { pathname } = body.payload;

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: "BLOB_READ_WRITE_TOKEN is not configured" },
        { status: 500 }
      );
    }

    const callbackUrl = new URL(
      "/api/admin/blob-token",
      request.url
    ).toString();

    const clientToken = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname,
      allowedContentTypes: ["application/pdf"],
      maximumSizeInBytes: 500 * 1024 * 1024,
      validUntil: Date.now() + 2 * 60 * 60 * 1000,
      addRandomSuffix: false,
      onUploadCompleted: { callbackUrl },
    });

    return NextResponse.json({
      type: "blob.generate-client-token",
      clientToken,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Unexpected error: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
