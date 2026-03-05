import { NextResponse } from "next/server";
import { decode } from "next-auth/jwt";

const SESSION_COOKIE = "sf.session-token";

export const runtime = "edge";

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

function parseBlobParams(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  return { url, blobToken };
}

export async function HEAD(request: Request) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { url, blobToken } = parseBlobParams(request);
  if (!url || !url.includes("blob.vercel-storage.com")) {
    return NextResponse.json({ error: "Invalid blob URL" }, { status: 400 });
  }
  if (!blobToken) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
  }

  try {
    const blobRes = await fetch(url, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${blobToken}` },
    });
    if (!blobRes.ok) {
      return new Response(null, { status: blobRes.status });
    }
    return new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": blobRes.headers.get("Content-Length") || "0",
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response(null, { status: 500 });
  }
}

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { url, blobToken } = parseBlobParams(request);
  if (!url || !url.includes("blob.vercel-storage.com")) {
    return NextResponse.json({ error: "Invalid blob URL" }, { status: 400 });
  }
  if (!blobToken) {
    return NextResponse.json({ error: "Storage not configured" }, { status: 500 });
  }

  try {
    const fetchHeaders: Record<string, string> = {
      Authorization: `Bearer ${blobToken}`,
    };
    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      fetchHeaders["Range"] = rangeHeader;
    }

    const blobRes = await fetch(url, { headers: fetchHeaders });
    if (!blobRes.ok && blobRes.status !== 206) {
      return NextResponse.json(
        { error: `Blob CDN returned ${blobRes.status}` },
        { status: blobRes.status }
      );
    }

    const resHeaders: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    };
    const cl = blobRes.headers.get("Content-Length");
    if (cl) resHeaders["Content-Length"] = cl;
    const cr = blobRes.headers.get("Content-Range");
    if (cr) resHeaders["Content-Range"] = cr;

    return new Response(blobRes.body, {
      status: blobRes.status,
      headers: resHeaders,
    });
  } catch (e) {
    console.error("[blob/serve] error:", e);
    return NextResponse.json(
      { error: (e as Error).message || "Failed to serve file" },
      { status: 500 }
    );
  }
}
