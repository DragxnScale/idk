import { NextRequest, NextResponse } from "next/server";
import { getAppUser } from "@/lib/app-user";

export const maxDuration = 60;

const ALLOWED_HOSTS = [
  "archive.org",
  "openstax.org",
  "assets.openstax.org",
  "vercel-storage.com",
  "blob.vercel-storage.com",
];

export async function GET(request: NextRequest) {
  const user = await getAppUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url parameter is required" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (!ALLOWED_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 403 });
  }

  const range = request.headers.get("range");
  const headers: Record<string, string> = {
    "User-Agent": "BowlBeacon/1.0",
  };
  if (range) {
    headers["Range"] = range;
  }

  const upstream = await fetch(url, { headers });

  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json(
      { error: `Upstream returned ${upstream.status}` },
      { status: 502 }
    );
  }

  const responseHeaders: Record<string, string> = {
    "Content-Type": "application/pdf",
    // max-age: browser cache 7 days
    // s-maxage: Vercel edge CDN cache 30 days — cache misses only on first request per edge region
    // stale-while-revalidate: serve stale from edge while refreshing in background
    "Cache-Control": "public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400",
  };

  const contentLength = upstream.headers.get("content-length");
  if (contentLength) responseHeaders["Content-Length"] = contentLength;

  const contentRange = upstream.headers.get("content-range");
  if (contentRange) responseHeaders["Content-Range"] = contentRange;

  const acceptRanges = upstream.headers.get("accept-ranges");
  if (acceptRanges) responseHeaders["Accept-Ranges"] = acceptRanges;

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function HEAD(request: NextRequest) {
  const user = await getAppUser();
  if (!user?.id) {
    return new NextResponse(null, { status: 401 });
  }

  const url = request.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse(null, { status: 400 });

  let parsed: URL;
  try { parsed = new URL(url); } catch { return new NextResponse(null, { status: 400 }); }

  if (!ALLOWED_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))) {
    return new NextResponse(null, { status: 403 });
  }

  const upstream = await fetch(url, { method: "HEAD", headers: { "User-Agent": "BowlBeacon/1.0" } });
  const h: Record<string, string> = {
    "Content-Type": "application/pdf",
    "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
  };
  const cl = upstream.headers.get("content-length");
  if (cl) h["Content-Length"] = cl;

  return new NextResponse(null, { status: 200, headers: h });
}
