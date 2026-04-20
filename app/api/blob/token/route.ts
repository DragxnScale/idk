import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";

export async function POST(request: Request): Promise<Response> {
  console.log("[blob/token] POST received");

  let body;
  try {
    body = await request.json();
  } catch (e) {
    console.error("[blob/token] body parse error:", e);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  console.log("[blob/token] body.type:", body.type);

  if (body.type === "blob.upload-completed") {
    return NextResponse.json({ type: "blob.upload-completed" });
  }

  let user;
  try {
    user = await getAppUser();
    console.log("[blob/token] auth result:", !!user?.id);
  } catch (e) {
    console.error("[blob/token] auth error:", e);
    return NextResponse.json({ error: "Auth failed" }, { status: 500 });
  }

  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.error("[blob/token] BLOB_READ_WRITE_TOKEN not set");
    return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
  }

  const { pathname } = body.payload ?? {};
  if (!pathname) {
    return NextResponse.json({ error: "pathname is required" }, { status: 400 });
  }

  try {
    const callbackUrl = new URL("/api/blob/token", request.url).toString();
    console.log("[blob/token] generating token for:", pathname, "callback:", callbackUrl);

    const clientToken = await generateClientTokenFromReadWriteToken({
      token,
      pathname,
      allowedContentTypes: ["application/pdf"],
      maximumSizeInBytes: 500 * 1024 * 1024,
      validUntil: Date.now() + 2 * 60 * 60 * 1000,
      onUploadCompleted: { callbackUrl },
    });

    console.log("[blob/token] token generated OK");
    return NextResponse.json({ type: "blob.generate-client-token", clientToken });
  } catch (e) {
    console.error("[blob/token] token generation error:", e);
    return NextResponse.json(
      { error: `Token generation failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
