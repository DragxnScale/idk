import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const ALLOWED_HOSTS = [
  "archive.org",
  "openstax.org",
  "assets.openstax.org",
  "vercel-storage.com",
  "blob.vercel-storage.com",
];

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
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
    "Cache-Control": "public, max-age=86400",
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
