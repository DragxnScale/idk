import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

// Dedicated blob token endpoint for admin uploads.
// Does NOT save to the documents DB — the file is a staging blob
// that gets streamed to archive.org and then deleted.
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody;

  // Short-circuit completion callbacks BEFORE handleUpload runs.
  // For admin uploads the completion is a no-op, so there is nothing to
  // verify. Returning 200 immediately prevents ANY retry loop regardless
  // of what handleUpload or token verification might otherwise throw.
  if (body.type === "blob.upload-completed") {
    return NextResponse.json({ type: "blob.upload-completed", response: "ok" });
  }

  // Token generation — require admin session.
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Derive the callback URL from the live request URL so it is always correct
  // regardless of which Vercel system environment variables are set.
  const callbackUrl = new URL("/api/admin/blob-token", request.url).toString();

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["application/pdf"],
        maximumSizeInBytes: 500 * 1024 * 1024,
        callbackUrl,
      }),
      onUploadCompleted: async () => {
        // No-op — staging blobs are transferred to archive.org then deleted.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
