/**
 * Client upload init.
 *
 * Returns a presigned R2 upload contract:
 *
 *   - size > 50 MB → `{ backend: "r2", mode: "multipart", pathname, objectUrl }`.
 *     The browser drives the multipart flow via `/api/blob/r2-multipart`.
 *   - otherwise → `{ backend: "r2", mode: "single", uploadUrl, objectUrl, pathname }`.
 *     The browser PUTs the raw file body directly to `uploadUrl`.
 *
 * The browser-side `lib/upload-client.ts` handles both shapes.
 */
import { NextResponse } from "next/server";
import { decode } from "next-auth/jwt";
import { r2EndpointUrl, r2PresignedPutUrl } from "@/lib/storage-backend";

const SESSION_COOKIE = "sf.session-token";
const ADMIN_EMAIL = "jaydenw0711@gmail.com";

// Node runtime — the storage adapter pulls in the AWS SDK.
export const runtime = "nodejs";

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

  let body: { pathname: string; admin?: boolean; size?: number };
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
    // Above ~50 MB the single PUT becomes a stall risk (one TCP connection
    // has to survive minutes of continuous body streaming through R2's
    // edge). Switch to multipart so a stalled chunk only retries that
    // 8 MB instead of the full file. We don't open the multipart upload
    // here — the client does it via `action: "start"` so an abandoned
    // init doesn't leak an orphan UploadId.
    const R2_MULTIPART_THRESHOLD_BYTES = 50 * 1024 * 1024;
    const useMultipart =
      typeof body.size === "number" && body.size > R2_MULTIPART_THRESHOLD_BYTES;

    if (useMultipart) {
      return NextResponse.json({
        backend: "r2",
        mode: "multipart",
        pathname: body.pathname,
        objectUrl: r2EndpointUrl(body.pathname),
      });
    }

    const { uploadUrl, objectUrl } = await r2PresignedPutUrl(body.pathname, {
      contentType: "application/pdf",
      // 4 hours: textbook PDFs can be 150–300 MB and admin uploads from
      // slow connections (hotel wifi, mobile tether) need plenty of
      // headroom — at 1 Mbps a 200 MB file takes ~27 min, and we want
      // at least one full retry to fit inside the window without
      // re-minting the URL.
      expiresInSeconds: 4 * 60 * 60,
    });
    return NextResponse.json({
      backend: "r2",
      mode: "single",
      uploadUrl,
      objectUrl,
      pathname: body.pathname,
    });
  } catch (e) {
    console.error("[client-token] r2 presign error:", e);
    return NextResponse.json(
      { error: (e as Error).message || "Presign failed" },
      { status: 500 }
    );
  }
}
