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
    return uploadSinglePutToR2(file, initRes, onProgress);
  }
  return uploadMultipartToVercelBlob(file, pathname, initRes.clientToken, onProgress);
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

    onProgress(2, "Starting upload…");
    xhr.send(file);
  });
}
