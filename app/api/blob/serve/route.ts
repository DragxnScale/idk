import { NextResponse } from "next/server";
import { decode } from "next-auth/jwt";

const SESSION_COOKIE = "sf.session-token";

export const runtime = "edge";
export const maxDuration = 300;

async function getUserId(request: Request): Promise<string | null> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  const raw = match?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return null;
  try {
    const token = await decode({
      token: decodeURIComponent(raw),
      secret: process.env.NEXTAUTH_SECRET!,
      salt: "",
    });
    return token?.sub ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url || !url.includes("blob.vercel-storage.com")) {
    return NextResponse.json({ error: "Invalid blob URL" }, { status: 400 });
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
  }

  try {
    const blobRes = await fetch(url, {
      headers: { Authorization: `Bearer ${blobToken}` },
    });
    if (!blobRes.ok) {
      return NextResponse.json(
        { error: `Blob CDN returned ${blobRes.status}` },
        { status: blobRes.status }
      );
    }

    return new Response(blobRes.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": blobRes.headers.get("Content-Length") || "",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    console.error("[blob/serve] error:", e);
    return NextResponse.json(
      { error: (e as Error).message || "Failed to serve file" },
      { status: 500 }
    );
  }
}
