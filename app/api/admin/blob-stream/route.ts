import { NextResponse } from "next/server";
import { requireAdminEdge } from "@/lib/admin-edge";
import { putPdf } from "@/lib/storage-backend";

// Node runtime — see lib/storage-backend.ts header comment.
export const runtime = "nodejs";
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
    const stored = await putPdf(pathname, request.body, {
      contentType: "application/pdf",
    });
    console.log("[blob-stream] done:", stored.url);
    return NextResponse.json({ url: stored.url });
  } catch (err) {
    console.error("[blob-stream] put() error:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
