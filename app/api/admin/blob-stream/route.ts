import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireAdminEdge } from "@/lib/admin-edge";

export const runtime = "edge";
export const maxDuration = 300;

export async function POST(request: Request) {
  let session;
  try {
    session = await requireAdminEdge(request);
  } catch (e) {
    console.error("[blob-stream] auth error:", e);
    return NextResponse.json({ error: `Auth error: ${(e as Error).message}` }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("[blob-stream] BLOB_READ_WRITE_TOKEN not set");
    return NextResponse.json({ error: "Storage not configured (BLOB_READ_WRITE_TOKEN missing)" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const pathname = searchParams.get("pathname");
  if (!pathname) {
    return NextResponse.json({ error: "pathname is required" }, { status: 400 });
  }

  if (!request.body) {
    return NextResponse.json({ error: "No file body" }, { status: 400 });
  }

  try {
    console.log("[blob-stream] uploading:", pathname);
    const blob = await put(pathname, request.body, {
      access: "private",
      contentType: "application/pdf",
      multipart: true,
    });
    console.log("[blob-stream] done:", blob.url);
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    console.error("[blob-stream] put() error:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
