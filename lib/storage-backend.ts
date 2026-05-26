/**
 * Pluggable PDF storage backend.
 *
 * Today we support two backends:
 *   - "vercel-blob"  → @vercel/blob (status quo)
 *   - "r2"           → Cloudflare R2 (S3-compatible)
 *
 * Selection at boot via STORAGE_BACKEND. Defaults to "vercel-blob" so
 * existing production keeps working until cutover.
 *
 * Reads (deletes too) are dispatched by URL host, **not** by the active
 * backend, so during the migration window mixed URLs (some on VB, some
 * on R2) all work.
 */
import { del as vbDel, list as vbList, put as vbPut } from "@vercel/blob";
import {
  S3Client,
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type BackendName = "vercel-blob" | "r2";

export const ACTIVE_BACKEND: BackendName =
  process.env.STORAGE_BACKEND === "r2" ? "r2" : "vercel-blob";

// ── R2 client (lazy) ─────────────────────────────────────────────────

let _r2Client: S3Client | null = null;
function r2(): S3Client {
  if (_r2Client) return _r2Client;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 env vars missing (need R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)."
    );
  }
  _r2Client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    // R2 doesn't support automatic checksum middleware that AWS SDK adds
    // by default in newer versions. Disabling avoids "checksum mismatch"
    // 400 errors on PutObject.
    forcePathStyle: true,
  });
  return _r2Client;
}

function r2Bucket(): string {
  const b = process.env.R2_BUCKET;
  if (!b) throw new Error("R2_BUCKET env var is missing.");
  return b;
}

// ── URL classification ───────────────────────────────────────────────

export function isVercelBlobUrl(url: string): boolean {
  return url.includes("blob.vercel-storage.com");
}

export function isR2Url(url: string): boolean {
  if (url.includes(".r2.cloudflarestorage.com")) return true;
  const publicBase = process.env.R2_PUBLIC_BASE_URL;
  if (publicBase && url.startsWith(publicBase)) return true;
  return false;
}

/**
 * Given a stored URL, return the R2 object key. Works for both:
 *   - https://<account>.r2.cloudflarestorage.com/<bucket>/<key>
 *   - https://<custom-domain>/<key>   (R2_PUBLIC_BASE_URL prefix)
 */
export function r2KeyFromUrl(url: string): string | null {
  const publicBase = process.env.R2_PUBLIC_BASE_URL;
  if (publicBase && url.startsWith(publicBase)) {
    return url.slice(publicBase.length).replace(/^\/+/, "");
  }

  const match = url.match(/\.r2\.cloudflarestorage\.com\/([^?]+)/);
  if (!match) return null;
  const path = match[1];
  const bucket = process.env.R2_BUCKET;
  if (bucket && path.startsWith(`${bucket}/`)) {
    return path.slice(bucket.length + 1);
  }
  return path;
}

/**
 * URL we store in the DB for an R2-backed object. Always endpoint-based
 * so it round-trips through `r2KeyFromUrl()` regardless of whether the
 * deployment later adds a public custom domain.
 */
export function r2EndpointUrl(key: string): string {
  const endpoint = process.env.R2_ENDPOINT;
  if (!endpoint) throw new Error("R2_ENDPOINT env var is missing.");
  return `${endpoint.replace(/\/+$/, "")}/${r2Bucket()}/${key}`;
}

// ── putPdf ───────────────────────────────────────────────────────────

export interface PutResult {
  url: string;
  pathname: string;
}

/**
 * Upload a PDF to the active backend. `pathname` is the object key
 * (`<userId>/<id>.pdf`, `public/<slug>/<file>.pdf`, etc.).
 */
export async function putPdf(
  pathname: string,
  body: ReadableStream | Buffer | Uint8Array,
  opts?: { contentType?: string }
): Promise<PutResult> {
  const contentType = opts?.contentType ?? "application/pdf";

  if (ACTIVE_BACKEND === "r2") {
    const upload = new Upload({
      client: r2(),
      params: {
        Bucket: r2Bucket(),
        Key: pathname,
        Body: body as never,
        ContentType: contentType,
      },
      // R2 multipart minimum part size is 5 MB.
      partSize: 8 * 1024 * 1024,
      queueSize: 4,
    });
    await upload.done();
    return { url: r2EndpointUrl(pathname), pathname };
  }

  // Vercel Blob — keep streaming + multipart for big files.
  // The VB SDK accepts Buffer/ReadableStream/Blob/File but not raw
  // Uint8Array, so coerce.
  const vbBody =
    body instanceof Uint8Array && !Buffer.isBuffer(body) ? Buffer.from(body) : body;
  const blob = await vbPut(pathname, vbBody, {
    access: "public",
    contentType,
    multipart: true,
  });
  return { url: blob.url, pathname: blob.pathname };
}

// ── deletePdf ────────────────────────────────────────────────────────

/**
 * Delete a PDF by URL. Dispatches by URL host so both legacy
 * Vercel-Blob URLs and new R2 URLs are handled correctly during and
 * after the migration window.
 */
export async function deletePdf(url: string): Promise<void> {
  if (isVercelBlobUrl(url)) {
    await vbDel(url).catch(() => {});
    return;
  }
  if (isR2Url(url)) {
    const key = r2KeyFromUrl(url);
    if (!key) return;
    await r2()
      .send(
        new DeleteObjectCommand({
          Bucket: r2Bucket(),
          Key: key,
        })
      )
      .catch(() => {});
    return;
  }
  // Unknown URL — no-op (could be an external link the user pasted).
}

// ── listPdfs (admin Storage tab) ─────────────────────────────────────

export interface ListedObject {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string;
  backend: BackendName;
}

/**
 * List every PDF the app owns across configured backends. The admin
 * Storage tab uses this to render its blob list. We list both backends
 * if both are configured, so the admin can see leftover Vercel Blob
 * objects after switching `STORAGE_BACKEND` to r2.
 */
export async function listPdfs(): Promise<{
  objects: ListedObject[];
  totalSize: number;
}> {
  const objects: ListedObject[] = [];

  // Vercel Blob — always list if its token is available.
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    let cursor: string | undefined;
    do {
      const res = await vbList({ cursor, limit: 100 });
      for (const b of res.blobs) {
        objects.push({
          url: b.url,
          pathname: b.pathname,
          size: b.size,
          uploadedAt: b.uploadedAt.toISOString(),
          backend: "vercel-blob",
        });
      }
      cursor = res.hasMore ? res.cursor : undefined;
    } while (cursor);
  }

  // R2 — list if its env vars are configured.
  if (
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET
  ) {
    let token: string | undefined;
    do {
      const res = await r2().send(
        new ListObjectsV2Command({
          Bucket: r2Bucket(),
          ContinuationToken: token,
          MaxKeys: 1000,
        })
      );
      for (const obj of res.Contents ?? []) {
        if (!obj.Key) continue;
        objects.push({
          url: r2EndpointUrl(obj.Key),
          pathname: obj.Key,
          size: obj.Size ?? 0,
          uploadedAt: obj.LastModified?.toISOString() ?? "",
          backend: "r2",
        });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  }

  const totalSize = objects.reduce((s, o) => s + o.size, 0);
  return { objects, totalSize };
}

// ── Read serving (called from /api/blob/serve) ───────────────────────

export interface FetchPdfResult {
  status: number;
  body: ReadableStream | null;
  contentType: string;
  contentLength: string | null;
  contentRange: string | null;
}

/**
 * Fetch a PDF (with optional Range) from whichever backend hosts it.
 * Used by `/api/blob/serve` to stream bytes back to the client.
 */
export async function fetchPdf(
  url: string,
  range: string | null
): Promise<FetchPdfResult> {
  if (isVercelBlobUrl(url)) {
    const headers: Record<string, string> = {};
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (range) headers.Range = range;
    const res = await fetch(url, { headers });
    return {
      status: res.status,
      body: res.body,
      contentType: "application/pdf",
      contentLength: res.headers.get("Content-Length"),
      contentRange: res.headers.get("Content-Range"),
    };
  }

  if (isR2Url(url)) {
    const key = r2KeyFromUrl(url);
    if (!key) {
      return {
        status: 404,
        body: null,
        contentType: "application/pdf",
        contentLength: null,
        contentRange: null,
      };
    }
    const cmd = new GetObjectCommand({
      Bucket: r2Bucket(),
      Key: key,
      Range: range ?? undefined,
    });
    const res = await r2().send(cmd);
    const body =
      (res.Body as { transformToWebStream?: () => ReadableStream } | undefined)
        ?.transformToWebStream?.() ?? null;
    return {
      status: range ? 206 : 200,
      body,
      contentType: res.ContentType ?? "application/pdf",
      contentLength: res.ContentLength != null ? String(res.ContentLength) : null,
      contentRange: res.ContentRange ?? null,
    };
  }

  // Unknown host — refuse.
  return {
    status: 400,
    body: null,
    contentType: "application/pdf",
    contentLength: null,
    contentRange: null,
  };
}

// ── HEAD probe ───────────────────────────────────────────────────────

export async function headPdf(
  url: string
): Promise<{ status: number; size: string | null }> {
  if (isVercelBlobUrl(url)) {
    const headers: Record<string, string> = {};
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { method: "HEAD", headers });
    return { status: res.status, size: res.headers.get("Content-Length") };
  }
  if (isR2Url(url)) {
    const key = r2KeyFromUrl(url);
    if (!key) return { status: 404, size: null };
    try {
      const res = await r2().send(
        new HeadObjectCommand({ Bucket: r2Bucket(), Key: key })
      );
      return {
        status: 200,
        size: res.ContentLength != null ? String(res.ContentLength) : null,
      };
    } catch {
      return { status: 404, size: null };
    }
  }
  return { status: 400, size: null };
}

// ── Presigned PUT (R2 client uploads) ────────────────────────────────

/**
 * Presigned URL the **browser** PUTs the raw file body to. Only used
 * when `STORAGE_BACKEND=r2`. For Vercel Blob we keep the existing
 * `@vercel/blob/client` flow.
 */
export async function r2PresignedPutUrl(
  key: string,
  opts: { contentType?: string; expiresInSeconds?: number } = {}
): Promise<{ uploadUrl: string; objectUrl: string; key: string }> {
  if (ACTIVE_BACKEND !== "r2") {
    throw new Error("r2PresignedPutUrl called while backend is not r2");
  }
  const cmd = new PutObjectCommand({
    Bucket: r2Bucket(),
    Key: key,
    ContentType: opts.contentType ?? "application/pdf",
  });
  const uploadUrl = await getSignedUrl(r2(), cmd, {
    // Default 1 hour — generous enough for any normal browser upload, while
    // still time-boxing the credential. Callers (e.g. the admin upload route)
    // pass a longer window explicitly for huge files.
    expiresIn: opts.expiresInSeconds ?? 60 * 60,
  });
  return { uploadUrl, objectUrl: r2EndpointUrl(key), key };
}

// ── R2 multipart upload (browser-driven) ─────────────────────────────
//
// Single-PUT browser uploads of 150–300 MB textbook PDFs are fragile —
// a single TCP stall mid-flight (Wi-Fi roam, captive portal re-auth,
// CDN proxy buffering, an idle timeout at some hop) kills the entire
// request and forces a full retry from byte 0. S3 multipart uploads
// replace that one giant request with N independent ~8 MB PUTs, each
// to its own freshly-signed URL, so a stalled part only costs a
// retry of that 8 MB chunk instead of the full file.
//
// The browser drives the flow via four route actions:
//   start → createMultipartUpload → { uploadId, key }
//   sign-part → presigned UploadPart URL per part
//   complete → completeMultipartUpload(parts)
//   abort → abortMultipartUpload (called on hard client failure so we
//     don't leak orphan multipart uploads in R2; R2 bills storage
//     for incomplete uploads until they're aborted or auto-expired).

/**
 * Start a multipart upload against R2 and return the upload id +
 * object key the browser will then use to sign + upload parts.
 */
export async function r2StartMultipartUpload(
  key: string,
  opts: { contentType?: string } = {}
): Promise<{ uploadId: string; key: string }> {
  if (ACTIVE_BACKEND !== "r2") {
    throw new Error("r2StartMultipartUpload called while backend is not r2");
  }
  const res = await r2().send(
    new CreateMultipartUploadCommand({
      Bucket: r2Bucket(),
      Key: key,
      ContentType: opts.contentType ?? "application/pdf",
    })
  );
  if (!res.UploadId) {
    throw new Error("R2 CreateMultipartUpload returned no UploadId");
  }
  return { uploadId: res.UploadId, key };
}

/**
 * Sign a single part PUT URL for a multipart upload. Each part gets
 * its own URL so failures retry independently.
 */
export async function r2PresignedUploadPartUrl(
  key: string,
  uploadId: string,
  partNumber: number,
  opts: { expiresInSeconds?: number } = {}
): Promise<{ uploadUrl: string }> {
  if (ACTIVE_BACKEND !== "r2") {
    throw new Error("r2PresignedUploadPartUrl called while backend is not r2");
  }
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
    throw new Error(`Invalid partNumber ${partNumber} (must be 1..10000)`);
  }
  const cmd = new UploadPartCommand({
    Bucket: r2Bucket(),
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  const uploadUrl = await getSignedUrl(r2(), cmd, {
    expiresIn: opts.expiresInSeconds ?? 60 * 60,
  });
  return { uploadUrl };
}

/**
 * Finalise a multipart upload. Parts must be sorted by partNumber
 * ascending — S3/R2 reject CompleteMultipartUpload with
 * `InvalidPartOrder` if they aren't. The browser passes them in any
 * order (whichever finishes first) so we re-sort here.
 */
export async function r2CompleteMultipartUpload(
  key: string,
  uploadId: string,
  parts: Array<{ partNumber: number; etag: string }>
): Promise<{ url: string; key: string }> {
  if (ACTIVE_BACKEND !== "r2") {
    throw new Error("r2CompleteMultipartUpload called while backend is not r2");
  }
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  await r2().send(
    new CompleteMultipartUploadCommand({
      Bucket: r2Bucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sorted.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    })
  );
  return { url: r2EndpointUrl(key), key };
}

/**
 * Abort an in-flight multipart upload. Safe to call on a UploadId
 * that no longer exists — we swallow NoSuchUpload because callers
 * (cancel / hard-error paths) shouldn't double-fail because cleanup
 * already happened.
 */
export async function r2AbortMultipartUpload(
  key: string,
  uploadId: string
): Promise<void> {
  if (ACTIVE_BACKEND !== "r2") {
    throw new Error("r2AbortMultipartUpload called while backend is not r2");
  }
  await r2()
    .send(
      new AbortMultipartUploadCommand({
        Bucket: r2Bucket(),
        Key: key,
        UploadId: uploadId,
      })
    )
    .catch(() => {});
}
