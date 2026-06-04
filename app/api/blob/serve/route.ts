/**
 * Authenticated PDF read gate.
 *
 * Originally streamed bytes back through this Vercel Function so private
 * Vercel Blob URLs (bearer-token-required) and R2 URLs (SigV4-required)
 * could be loaded by browser PDF viewers using only the same-origin
 * cookie. That worked but counted every byte of every page-flip toward
 * Vercel's Fast Origin Transfer billable metric.
 *
 * Now we 302-redirect to a URL the browser can fetch directly:
 *   - R2 + key starts with `public/` AND `R2_PUBLIC_BASE_URL` is set →
 *     redirect to the public URL (custom domain or r2.dev). Bytes flow
 *     R2 edge → browser. No Vercel egress.
 *   - R2 + private key (`<userId>/...`) → redirect to a 1 h presigned
 *     GET URL. Same direct R2 → browser path; the cookie auth check
 *     still happens server-side here.
 *   - Vercel Blob legacy URL → keep the byte-proxy fallback so any URL
 *     that hasn't been migrated yet still serves correctly. After the
 *     migration script reports zero VB URLs in the DB this branch is
 *     dead code and can be removed.
 *   - R2 with a public key but no `R2_PUBLIC_BASE_URL` configured →
 *     fall back to the byte-proxy. Lets the deployment ship before the
 *     Cloudflare-dashboard r2.dev toggle is flipped.
 */
import { NextResponse } from "next/server";
import { decode } from "next-auth/jwt";
import {
  fetchPdf,
  headPdf,
  isR2Url,
  isVercelBlobUrl,
  publicR2UrlFor,
  r2KeyFromUrl,
  r2PresignedGetUrl,
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

/**
 * Decide what to do with an R2 URL: 302-redirect to a public URL, 302
 * to a presigned URL, or null to signal "fall back to streaming bytes".
 */
function r2RedirectTarget(url: string): {
  target: string;
  cacheControl: string;
} | null {
  const key = r2KeyFromUrl(url);
  if (!key) return null;

  // public/<slug>/... is intentionally world-readable. Send the browser
  // straight to the public R2 URL when one is configured.
  if (key.startsWith("public/")) {
    const publicUrl = publicR2UrlFor(key);
    if (publicUrl) {
      return {
        target: publicUrl,
        cacheControl: "public, max-age=300",
      };
    }
    // Fall through: caller will stream bytes (graceful pre-cf-prep mode).
    return null;
  }

  // Anything else is private user content — caller should presign.
  return null;
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

  // 302 dispatch (matching GET) — see GET() for rationale.
  if (isR2Url(url)) {
    const redirect = r2RedirectTarget(url);
    if (redirect) {
      return new Response(null, {
        status: 302,
        headers: { Location: redirect.target, "Cache-Control": redirect.cacheControl },
      });
    }
    const key = r2KeyFromUrl(url);
    if (key && !key.startsWith("public/")) {
      try {
        const signed = await r2PresignedGetUrl(key);
        return new Response(null, {
          status: 302,
          headers: { Location: signed, "Cache-Control": "private, no-store" },
        });
      } catch (e) {
        console.error("[blob/serve HEAD] presign failed:", e);
      }
    }
  }

  // Fallback: actually probe and stream the headers back.
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

  // R2: redirect to a URL the browser can fetch directly. Bytes never
  // flow through this Function once a redirect path is taken.
  if (isR2Url(url)) {
    const redirect = r2RedirectTarget(url);
    if (redirect) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: redirect.target,
          "Cache-Control": redirect.cacheControl,
        },
      });
    }

    // Private key path — presign a GET URL and 302 the browser to it.
    const key = r2KeyFromUrl(url);
    if (key && !key.startsWith("public/")) {
      try {
        const signed = await r2PresignedGetUrl(key);
        return new Response(null, {
          status: 302,
          headers: {
            Location: signed,
            "Cache-Control": "private, no-store",
          },
        });
      } catch (e) {
        console.error("[blob/serve] presign failed:", e);
        return NextResponse.json(
          { error: "Failed to sign R2 URL" },
          { status: 500 }
        );
      }
    }

    // R2 public key but R2_PUBLIC_BASE_URL is unset — fall through to
    // the byte-proxy below. Once the dashboard toggle is flipped and
    // the env var is set, the redirect path above takes over with no
    // code change required.
  }

  // Vercel Blob (legacy) OR R2 with public key + no public base URL:
  // proxy bytes the old way. After migration this branch handles only
  // the leftover VB URLs (which should be zero post-migration).
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
