import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Enforce PDF only, up to 500 MB
        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: 500 * 1024 * 1024,
          // Embed userId in the token so the completion handler knows who owns it
          tokenPayload: JSON.stringify({
            userId: session.user.id,
            title: decodeURIComponent(
              pathname.split("/").pop()?.replace(/\.pdf$/i, "").replace(/[-_]/g, " ") ?? "Untitled"
            ),
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Called by Vercel after the client finishes uploading
        const { userId, title } = JSON.parse(tokenPayload ?? "{}");
        if (!userId) return;
        const id = crypto.randomUUID();
        const now = new Date();
        await db.insert(documents).values({
          id,
          userId,
          title,
          sourceType: "upload",
          fileUrl: blob.url,
          createdAt: now,
          updatedAt: now,
        });
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
