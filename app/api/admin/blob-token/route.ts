import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

// Dedicated blob token endpoint for admin uploads.
// Does NOT save to the documents DB — the file is a staging blob
// that gets streamed to archive.org and then deleted.
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody;

  // Completion callbacks come from Vercel's CDN (no user session).
  // handleUpload verifies them via a signed token — no extra auth needed.
  if (body.type === "blob.generate-client-token") {
    const session = await requireAdmin();
    if (!session) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Derive the callback URL from the live request URL so it's always correct
  // regardless of which Vercel environment variable is set.
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
        // No-op — admin staging blobs are transferred to archive.org then deleted.
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (err) {
    // For completion callbacks: the upload already succeeded on Vercel's CDN,
    // so always return 200 to prevent the 5-retry loop even if verification
    // or the no-op handler throws for any reason.
    if (body.type === "blob.upload-completed") {
      console.error("blob-token completion error (ignored):", (err as Error).message);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
