import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { decode } from "next-auth/jwt";

const SESSION_COOKIE = "sf.session-token";
const ADMIN_EMAIL = "jaydenw0711@gmail.com";

export const runtime = "edge";

async function getUser(request: Request): Promise<{ id: string; isAdmin: boolean } | null> {
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
    if (!token?.sub) return null;
    const isAdmin = (token.email as string)?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    return { id: token.sub, isAdmin };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const user = await getUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
  }

  let body: { pathname: string; admin?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.pathname) {
    return NextResponse.json({ error: "pathname is required" }, { status: 400 });
  }

  if (body.admin && !user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const clientToken = await generateClientTokenFromReadWriteToken({
      token,
      pathname: body.pathname,
      allowedContentTypes: ["application/pdf"],
      maximumSizeInBytes: 500 * 1024 * 1024,
      validUntil: Date.now() + 2 * 60 * 60 * 1000,
      addRandomSuffix: false,
    });
    return NextResponse.json({ clientToken });
  } catch (e) {
    console.error("[client-token] error:", e);
    return NextResponse.json(
      { error: (e as Error).message || "Token generation failed" },
      { status: 500 }
    );
  }
}
