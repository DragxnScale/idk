/**
 * Authenticated PDF read proxy.
 *
 * Browser-side PDF viewers (react-pdf, iframe `<embed>`) can't speak to
 * private Vercel Blob URLs (they need a bearer token) or to R2 (auth-
 * required SigV4). This route adds the right authentication for the
 * URL's host and streams the bytes back same-origin so the cookie-based
 * session is the gating factor.
 *
 * Backend dispatch lives in `lib/storage-backend.ts` — adding a new
 * blob host means editing that file, not this one.
 */
import { NextResponse } from "next/server";
import { decode } from "next-auth/jwt";
import {
  fetchPdf,
  headPdf,
  isR2Url,
  isVercelBlobUrl,
} from "@/lib/storage-backend";

const SESSION_COOKIE = "sf.session-token";

// Node runtime — the AWS SDK pulls in some Node APIs the Edge runtime
// doesn't expose. Vercel Blob fetch still works fine on Node.
export const runtime = "nodejs";

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

function readUrlParam(request: Request): string | null {
  const { searchParams } = new URL(request.url);
  return searchParams.get("url");
}

function isAllowedHost(url: string): boolean {
  return isVercelBlobUrl(url) || isR2Url(url);
}

export async function HEAD(request: Request) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = readUrlParam(request);
  if (!url || !isAllowedHost(url)) {
    return NextResponse.json({ error: "Invalid blob URL" }, { status: 400 });
  }

  try {
    const probe = await headPdf(url);
    if (probe.status >= 400) {
      return new Response(null, { status: probe.status });
    }
    return new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": probe.size ?? "0",
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

  const url = readUrlParam(request);
  if (!url || !isAllowedHost(url)) {
    return NextResponse.json({ error: "Invalid blob URL" }, { status: 400 });
  }

  try {
    const range = request.headers.get("range");
    const result = await fetchPdf(url, range);

    if (result.status >= 400) {
      return NextResponse.json(
        { error: `Storage backend returned ${result.status}` },
        { status: result.status }
      );
    }

    const resHeaders: Record<string, string> = {
      "Content-Type": result.contentType || "application/pdf",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    };
    if (result.contentLength) resHeaders["Content-Length"] = result.contentLength;
    if (result.contentRange) resHeaders["Content-Range"] = result.contentRange;

    return new Response(result.body, {
      status: result.status,
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
