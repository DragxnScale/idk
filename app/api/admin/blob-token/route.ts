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

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["application/pdf"],
        maximumSizeInBytes: 500 * 1024 * 1024,
      }),
      onUploadCompleted: async () => {
        // No-op — admin staging blobs are deleted after archive.org transfer
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
