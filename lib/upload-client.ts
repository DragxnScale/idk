"use client";

/**
 * Browser-side PDF upload helper.
 *
 * Handles both upload contracts the server might return from
 * `/api/blob/client-token`:
 *
 *   - Vercel Blob: server hands back a `clientToken`; we use the
 *     `@vercel/blob/client` multipart uploader to talk to the CDN.
 *   - Cloudflare R2: server hands back a presigned PUT URL; we PUT the
 *     entire file body in one request via XHR (so we get progress).
 *
 * Callers don't need to know which backend is active; they just call
 * `uploadPdfToStorage()` and get back the final URL to register.
 */
import { createMultipartUploader } from "@vercel/blob/client";

const PART_SIZE = 8 * 1024 * 1024; // 8 MB — above Vercel Blob's 5 MB minimum

export type UploadProgress = (pct: number, label: string) => void;

interface InitVB {
  backend: "vercel-blob";
  clientToken: string;
}
interface InitR2 {
  backend: "r2";
  uploadUrl: string;
  objectUrl: string;
  pathname: string;
}
type InitResponse = InitVB | InitR2;

/**
 * Upload `file` to the active storage backend at the requested
 * `pathname` and return the final URL to store on the document row.
 */
export async function uploadPdfToStorage(
  file: File,
  pathname: string,
  onProgress: UploadProgress,
  init: { admin?: boolean } = {}
): Promise<string> {
  onProgress(0, "Getting upload token…");
  const tokenRes = await fetch("/api/blob/client-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pathname, admin: init.admin ?? false }),
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    throw new Error(err.error || `Token request failed (${tokenRes.status})`);
  }
  const initRes = (await tokenRes.json()) as InitResponse;

  if (initRes.backend === "r2") {
    return uploadSinglePutToR2WithRetry(file, initRes, onProgress);
  }
  return uploadMultipartToVercelBlob(file, pathname, initRes.clientToken, onProgress);
}

/**
 * Retry transient R2 PUT failures. Single-shot PUTs of large files are
 * vulnerable to brief network blips (Wi-Fi roaming, captive-portal
 * re-auth, etc.) — without retry the whole upload looks like a hard
 * failure to the user. We re-use the same presigned URL across retries
 * because it's valid for hours; only the body is re-uploaded.
 *
 * Retry policy:
 *   - Network errors (xhr.error) and 5xx responses are retried.
 *   - 4xx responses (auth/expired/CORS rejection) are NOT retried —
 *     they will not succeed on the next attempt and re-uploading
 *     hundreds of MB is wasteful.
 *   - Hard cap of 3 attempts (1 initial + 2 retries) with 1s/3s backoff.
 */
async function uploadSinglePutToR2WithRetry(
  file: File,
  init: InitR2,
  onProgress: UploadProgress
): Promise<string> {
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [1_000, 3_000];
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await uploadSinglePutToR2(file, init, onProgress);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      const retryable = isRetryableUploadError(lastErr);
      if (!retryable || attempt === MAX_ATTEMPTS) throw lastErr;
      const wait = BACKOFF_MS[attempt - 1] ?? 5_000;
      onProgress(
        0,
        `Retrying upload (attempt ${attempt + 1}/${MAX_ATTEMPTS} after ${Math.round(wait / 1000)}s)…`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr ?? new Error("Upload failed after retries");
}

function isRetryableUploadError(err: Error): boolean {
  const msg = err.message;
  if (msg.includes("Network error")) return true;
  // "Upload failed (5xx): …" → retry server errors only.
  const statusMatch = msg.match(/Upload failed \((\d{3})\)/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    return status >= 500 && status < 600;
  }
  return false;
}

async function uploadMultipartToVercelBlob(
  file: File,
  pathname: string,
  clientToken: string,
  onProgress: UploadProgress
): Promise<string> {
  onProgress(2, "Starting upload…");
  const uploader = await createMultipartUploader(pathname, {
    access: "private",
    token: clientToken,
    contentType: "application/pdf",
  });

  const totalParts = Math.ceil(file.size / PART_SIZE);
  const parts: { etag: string; partNumber: number }[] = [];

  for (let i = 0; i < totalParts; i++) {
    const start = i * PART_SIZE;
    const end = Math.min(start + PART_SIZE, file.size);
    const chunk = file.slice(start, end);
    const partNumber = i + 1;
    const pct = Math.round(((i + 0.5) / totalParts) * 88) + 2;
    onProgress(pct, `Uploading… ${pct}% (part ${partNumber}/${totalParts})`);

    const part = await uploader.uploadPart(partNumber, chunk);
    parts.push(part);
  }

  onProgress(92, "Finishing upload…");
  const blob = await uploader.complete(parts);
  return blob.url;
}

function uploadSinglePutToR2(
  file: File,
  init: InitR2,
  onProgress: UploadProgress
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", init.uploadUrl, true);
    xhr.setRequestHeader("Content-Type", "application/pdf");
    // Explicitly disable any default request timeout. A 200 MB PDF over a
    // slow connection can legitimately take >30 minutes; we don't want the
    // browser to time it out as a "network error" partway through.
    xhr.timeout = 0;

    xhr.upload.addEventListener("progress", (ev) => {
      if (!ev.lengthComputable) return;
      const pct = Math.round((ev.loaded / ev.total) * 88) + 2;
      onProgress(pct, `Uploading… ${pct}%`);
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(92, "Finishing upload…");
        resolve(init.objectUrl);
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
    // Surfaces as a network-style error so the retry wrapper picks it up.
    xhr.addEventListener("timeout", () => reject(new Error("Network error during upload (timeout)")));

    onProgress(2, "Starting upload…");
    xhr.send(file);
  });
}
