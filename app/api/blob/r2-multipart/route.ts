/**
 * R2 multipart upload coordinator.
 *
 * Drives the four S3 multipart steps from the browser. Reserved for
 * R2 large-file uploads (>50 MB) — single-PUT is fine below that and
 * Vercel Blob has its own client multipart uploader.
 *
 * The route is a single POST with an `action` discriminator instead
 * of four separate route files because all four operations share
 * exactly the same auth + admin gate and a single dispatch keeps the
 * surface area tight:
 *
 *   { action: "start", pathname }
 *     → { uploadId, key }
 *
 *   { action: "sign-part", uploadId, key, partNumber }
 *     → { uploadUrl }   (presigned PUT for that part)
 *
 *   { action: "complete", uploadId, key, parts: [{ partNumber, etag }] }
 *     → { url }   (final R2 object URL the caller stores in the DB)
 *
 *   { action: "abort", uploadId, key }
 *     → { ok: true }   (idempotent; safe even if upload already gone)
 *
 * Same admin gating as `/api/blob/client-token`: any caller may use
 * the route while signed in, but `admin: true` is required for the
 * `public/<slug>/...` pathnames the admin upload UI targets.
 */
import { NextResponse } from "next/server";
import { decode } from "next-auth/jwt";
import {
  ACTIVE_BACKEND,
  r2AbortMultipartUpload,
  r2CompleteMultipartUpload,
  r2PresignedUploadPartUrl,
  r2StartMultipartUpload,
} from "@/lib/storage-backend";

const SESSION_COOKIE = "sf.session-token";
const ADMIN_EMAIL = "jaydenw0711@gmail.com";

// Node runtime — AWS SDK lives in the storage adapter.
export const runtime = "nodejs";

async function getUser(
  request: Request
): Promise<{ id: string; isAdmin: boolean } | null> {
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
    const isAdmin =
      (token.email as string)?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    return { id: token.sub, isAdmin };
  } catch {
    return null;
  }
}

type StartBody = { action: "start"; pathname: string; admin?: boolean };
type SignPartBody = {
  action: "sign-part";
  uploadId: string;
  key: string;
  partNumber: number;
  admin?: boolean;
};
type CompleteBody = {
  action: "complete";
  uploadId: string;
  key: string;
  parts: Array<{ partNumber: number; etag: string }>;
  admin?: boolean;
};
type AbortBody = {
  action: "abort";
  uploadId: string;
  key: string;
  admin?: boolean;
};
type Body = StartBody | SignPartBody | CompleteBody | AbortBody;

export async function POST(request: Request) {
  if (ACTIVE_BACKEND !== "r2") {
    return NextResponse.json(
      { error: "Multipart route requires STORAGE_BACKEND=r2" },
      { status: 400 }
    );
  }

  const user = await getUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.admin && !user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    switch (body.action) {
      case "start": {
        if (!body.pathname) {
          return NextResponse.json(
            { error: "pathname is required" },
            { status: 400 }
          );
        }
        const { uploadId, key } = await r2StartMultipartUpload(body.pathname, {
          contentType: "application/pdf",
        });
        return NextResponse.json({ uploadId, key });
      }

      case "sign-part": {
        if (!body.uploadId || !body.key || !body.partNumber) {
          return NextResponse.json(
            { error: "uploadId, key, partNumber are required" },
            { status: 400 }
          );
        }
        const { uploadUrl } = await r2PresignedUploadPartUrl(
          body.key,
          body.uploadId,
          body.partNumber,
          // 4 h matches the existing single-PUT TTL — even a slow
          // connection has plenty of time to use every signed URL it
          // requested at start without re-minting.
          { expiresInSeconds: 4 * 60 * 60 }
        );
        return NextResponse.json({ uploadUrl });
      }

      case "complete": {
        if (
          !body.uploadId ||
          !body.key ||
          !Array.isArray(body.parts) ||
          body.parts.length === 0
        ) {
          return NextResponse.json(
            { error: "uploadId, key, parts[] are required" },
            { status: 400 }
          );
        }
        for (const p of body.parts) {
          if (
            !p ||
            typeof p.partNumber !== "number" ||
            typeof p.etag !== "string"
          ) {
            return NextResponse.json(
              { error: "Each part needs { partNumber:number, etag:string }" },
              { status: 400 }
            );
          }
        }
        const { url } = await r2CompleteMultipartUpload(
          body.key,
          body.uploadId,
          body.parts
        );
        return NextResponse.json({ url });
      }

      case "abort": {
        if (!body.uploadId || !body.key) {
          return NextResponse.json(
            { error: "uploadId, key are required" },
            { status: 400 }
          );
        }
        await r2AbortMultipartUpload(body.key, body.uploadId);
        return NextResponse.json({ ok: true });
      }

      default: {
        return NextResponse.json(
          { error: "Unknown action" },
          { status: 400 }
        );
      }
    }
  } catch (e) {
    console.error(`[r2-multipart] ${body.action} error:`, e);
    return NextResponse.json(
      { error: (e as Error).message || "Multipart action failed" },
      { status: 500 }
    );
  }
}
