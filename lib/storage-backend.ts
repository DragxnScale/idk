/**
 * PDF storage backend — Cloudflare R2 only.
 *
 * The previous Vercel Blob branch was removed after
 * `scripts/migrate-vercel-blob-to-r2.mjs` reported zero leftover
 * `blob.vercel-storage.com` URLs in the DB. The defensive
 * `isVercelBlobUrl()` stub is kept (always returns false) so any caller
 * that hasn't been updated yet still type-checks; it has no runtime
 * effect because no URLs in the system match.
 */
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

export type BackendName = "r2";

export const ACTIVE_BACKEND: BackendName = "r2";

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

/**
 * Defensive stub kept to avoid breaking any caller that hasn't been
 * updated since the Vercel Blob rip-out. There are no
 * `blob.vercel-storage.com` URLs left in the DB, so this is always
 * false in practice. Safe to delete this function once every caller is
 * known to be VB-free.
 */
export function isVercelBlobUrl(_url: string): boolean {
  return false;
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

/**
 * Public-bucket URL for a given key when `R2_PUBLIC_BASE_URL` is set
 * (custom domain or r2.dev). Returns null when the env var is missing,
 * which signals the caller to fall back to the byte-proxy or to a
 * presigned GET URL. Only safe for keys that are intentionally
 * world-readable — i.e. `public/<slug>/...` admin textbooks.
 */
export function publicR2UrlFor(key: string): string | null {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

// ── putPdf ───────────────────────────────────────────────────────────

export interface PutResult {
  url: string;
  pathname: string;
}

/**
 * Upload a PDF to R2. `pathname` is the object key
 * (`<userId>/<id>.pdf`, `public/<slug>/<file>.pdf`, etc.).
 */
export async function putPdf(
  pathname: string,
  body: ReadableStream | Buffer | Uint8Array,
  opts?: { contentType?: string }
): Promise<PutResult> {
  const contentType = opts?.contentType ?? "application/pdf";
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

// ── deletePdf ────────────────────────────────────────────────────────

/**
 * Delete a PDF by URL. Only R2 is supported; non-R2 URLs (external
 * sources the user pasted, etc.) are silently no-ops.
 */
export async function deletePdf(url: string): Promise<void> {
  if (!isR2Url(url)) return;
  const key = r2KeyFromUrl(url);
  if (!key) return;
  await r2()
    .send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: key }))
    .catch(() => {});
}

// ── listR2BucketObjects (admin Storage tab) ──────────────────────────

export interface ListedObject {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string;
  backend: BackendName;
}

export interface R2BucketListing {
  bucketName: string;
  objects: ListedObject[];
  objectCount: number;
  totalSize: number;
}

/** List every object in the R2 bucket. Used by the admin Storage tab. */
export async function listR2BucketObjects(): Promise<R2BucketListing> {
  const objects: ListedObject[] = [];

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

  const totalSize = objects.reduce((s, o) => s + o.size, 0);
  return {
    bucketName: r2Bucket(),
    objects,
    objectCount: objects.length,
    totalSize,
  };
}

/** @deprecated Use listR2BucketObjects — kept for call-site compatibility. */
export async function listPdfs(): Promise<{
  objects: ListedObject[];
  totalSize: number;
}> {
  const { objects, totalSize } = await listR2BucketObjects();
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
 * Fetch a PDF (with optional Range) from R2. The hot read path is now
 * `/api/blob/serve` issuing a 302 redirect to a public or presigned URL
 * — this byte-proxy fallback is only used when `R2_PUBLIC_BASE_URL` is
 * missing for a public key, which should be rare.
 */
export async function fetchPdf(
  url: string,
  range: string | null
): Promise<FetchPdfResult> {
  if (!isR2Url(url)) {
    return {
      status: 400,
      body: null,
      contentType: "application/pdf",
      contentLength: null,
      contentRange: null,
    };
  }

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

// ── HEAD probe ───────────────────────────────────────────────────────

export async function headPdf(
  url: string
): Promise<{ status: number; size: string | null }> {
  if (!isR2Url(url)) return { status: 400, size: null };
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

// ── Presigned PUT (R2 client uploads) ────────────────────────────────

/**
 * Presigned URL the **browser** PUTs the raw file body to.
 */
export async function r2PresignedPutUrl(
  key: string,
  opts: { contentType?: string; expiresInSeconds?: number } = {}
): Promise<{ uploadUrl: string; objectUrl: string; key: string }> {
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

/**
 * Presigned GET URL for browser-direct downloads. The auth route
 * (`/api/blob/serve`) issues these as a 302 target so the bytes flow
 * R2 → browser without ever touching the Vercel Function — eliminating
 * Fast Origin Transfer charges. Default TTL is 1 h; callers may shorten
 * it for highly sensitive content. The redirect itself MUST be served
 * with `Cache-Control: no-store` so the redirect can't outlive the URL.
 */
export async function r2PresignedGetUrl(
  key: string,
  opts: { expiresInSeconds?: number } = {}
): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: r2Bucket(), Key: key });
  return getSignedUrl(r2(), cmd, {
    expiresIn: opts.expiresInSeconds ?? 60 * 60,
  });
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

export async function r2StartMultipartUpload(
  key: string,
  opts: { contentType?: string } = {}
): Promise<{ uploadId: string; key: string }> {
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

export async function r2PresignedUploadPartUrl(
  key: string,
  uploadId: string,
  partNumber: number,
  opts: { expiresInSeconds?: number } = {}
): Promise<{ uploadUrl: string }> {
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

export async function r2CompleteMultipartUpload(
  key: string,
  uploadId: string,
  parts: Array<{ partNumber: number; etag: string }>
): Promise<{ url: string; key: string }> {
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

export async function r2AbortMultipartUpload(
  key: string,
  uploadId: string
): Promise<void> {
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
