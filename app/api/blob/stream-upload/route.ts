import { put } from "@vercel/blob";
import { decode } from "next-auth/jwt";
import { NextResponse } from "next/server";

export const runtime = "edge";
export const maxDuration = 300;

const SESSION_COOKIE = "sf.session-token";

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
    return (token?.sub as string) ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
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
    const blob = await put(pathname, request.body, {
      access: "public",
      contentType: "application/pdf",
      multipart: true,
    });
    return NextResponse.json({ url: blob.url, pathname: blob.pathname });
  } catch (err) {
    console.error("[stream-upload] error:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
