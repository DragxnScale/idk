"use client";

/**
 * Browser-side PDF upload helper.
 *
 * Handles three upload shapes:
 *
 *   - Vercel Blob: server hands back a `clientToken`; we use the
 *     `@vercel/blob/client` multipart uploader to talk to the CDN.
 *   - Cloudflare R2, small file (≤ R2_MULTIPART_THRESHOLD): server
 *     hands back a presigned PUT URL; we PUT the entire body in one
 *     XHR request with retry-with-backoff for transient blips.
 *   - Cloudflare R2, large file (> R2_MULTIPART_THRESHOLD): server
 *     tells us to use S3 multipart; we split the file into 8 MB
 *     parts, sign each part on demand, and upload chunks
 *     independently — a stalled or failed part only retries that
 *     8 MB instead of the whole 200 MB file.
 *
 * Callers don't need to know which backend (or which mode) is
 * active; they just call `uploadPdfToStorage()` and get back the
 * final URL to register.
 */
import { createMultipartUploader } from "@vercel/blob/client";

const PART_SIZE = 8 * 1024 * 1024; // 8 MB — above R2/S3 multipart minimum (5 MB)
const R2_MULTIPART_THRESHOLD_BYTES = 50 * 1024 * 1024; // mirrors the server-side threshold in /api/blob/client-token

// Stall-detection thresholds (single PUT and per-part).
const STALL_WARN_MS = 15_000; // log a "stalled" line after 15s with no XHR progress
const STALL_ABORT_MS = 60_000; // hard-abort the XHR after 60s with no progress → retry wrapper takes over

/**
 * Upload progress callback. `bytes` is included whenever the XHR
 * upload event reports a meaningful `loaded`/`total` pair — present
 * for in-flight per-byte updates, absent for one-shot status lines
 * like "Starting upload…" or retry separators.
 *
 * Callers may treat `bytes` as a display-only hint: if you only want
 * `(pct, label)`, ignore the third arg. The admin page uses it to
 * render a per-line bytes counter so the user can tell a genuinely
 * stalled upload from a slow one even when the rounded percentage
 * label is stuck on the same value for many events.
 */
export type UploadProgress = (
  pct: number,
  label: string,
  bytes?: { loaded: number; total: number }
) => void;

interface InitVB {
  backend: "vercel-blob";
  clientToken: string;
}
interface InitR2Single {
  backend: "r2";
  mode?: "single";
  uploadUrl: string;
  objectUrl: string;
  pathname: string;
}
interface InitR2Multipart {
  backend: "r2";
  mode: "multipart";
  pathname: string;
  objectUrl: string;
}
type InitResponse = InitVB | InitR2Single | InitR2Multipart;

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
    body: JSON.stringify({
      pathname,
      admin: init.admin ?? false,
      size: file.size,
    }),
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    throw new Error(err.error || `Token request failed (${tokenRes.status})`);
  }
  const initRes = (await tokenRes.json()) as InitResponse;

  if (initRes.backend === "r2") {
    if (initRes.mode === "multipart") {
      return uploadMultipartToR2(file, initRes, onProgress);
    }
    return uploadSinglePutToR2WithRetry(file, initRes, onProgress);
  }
  return uploadMultipartToVercelBlob(file, pathname, initRes.clientToken, onProgress);
}

// ── Single-PUT R2 (small files) ──────────────────────────────────────

/**
 * Retry transient R2 PUT failures. Single-shot PUTs of mid-size files
 * are vulnerable to brief network blips (Wi-Fi roaming, captive-portal
 * re-auth, etc.) — without retry the whole upload looks like a hard
 * failure to the user. We re-use the same presigned URL across retries
 * because it's valid for hours; only the body is re-uploaded.
 *
 * Retry policy:
 *   - Network errors (xhr.error / stall-abort) and 5xx responses are retried.
 *   - 4xx responses (auth/expired/CORS rejection) are NOT retried —
 *     they will not succeed on the next attempt and re-uploading
 *     hundreds of MB is wasteful.
 *   - Hard cap of 3 attempts (1 initial + 2 retries) with 1s/3s backoff.
 *   - A separator line is logged at the start of every attempt > 1 so
 *     the debug log visually demarcates "still stuck on attempt 1"
 *     from "inside attempt 2 and stuck again".
 */
async function uploadSinglePutToR2WithRetry(
  file: File,
  init: InitR2Single,
  onProgress: UploadProgress
): Promise<string> {
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [1_000, 3_000];
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      onProgress(0, `──── Attempt ${attempt}/${MAX_ATTEMPTS} starting ────`);
    }
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
  if (msg.includes("stalled")) return true;
  // "Upload failed (5xx): …" → retry server errors only.
  const statusMatch = msg.match(/Upload failed \((\d{3})\)/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    return status >= 500 && status < 600;
  }
  return false;
}

function uploadSinglePutToR2(
  file: File,
  init: InitR2Single,
  onProgress: UploadProgress
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", init.uploadUrl, true);
    xhr.setRequestHeader("Content-Type", "application/pdf");
    // Explicitly disable any default request timeout. A 200 MB PDF over a
    // slow connection can legitimately take >30 minutes; we don't want the
    // browser to time it out as a "network error" partway through. The
    // stall watchdog below handles "actually stuck" instead.
    xhr.timeout = 0;

    const watchdog = createStallWatchdog({
      label: "upload",
      onWarn: (state) => {
        onProgress(
          state.pct,
          `Stalled — no upload progress for ${Math.round(STALL_WARN_MS / 1000)}s ` +
            `(still at ${state.pct}%, ${fmtBytesPair(state.loaded, state.total)})`
        );
      },
      onAbort: (state) => {
        try {
          xhr.abort();
        } catch {
          // ignore
        }
        // Reject with a network-error-shaped message so the retry
        // wrapper picks it up instead of bubbling out as a fatal abort.
        reject(
          new Error(
            `Network error during upload (stalled — no progress for ${Math.round(
              STALL_ABORT_MS / 1000
            )}s at ${state.pct}%)`
          )
        );
      },
    });

    xhr.upload.addEventListener("progress", (ev) => {
      if (!ev.lengthComputable) return;
      const pct = Math.round((ev.loaded / ev.total) * 88) + 2;
      watchdog.notifyProgress(pct, ev.loaded, ev.total);
      onProgress(pct, `Uploading… ${pct}%`, {
        loaded: ev.loaded,
        total: ev.total,
      });
    });

    xhr.addEventListener("load", () => {
      watchdog.stop();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(92, "Finishing upload…");
        resolve(init.objectUrl);
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
      }
    });
    xhr.addEventListener("error", () => {
      watchdog.stop();
      reject(new Error("Network error during upload"));
    });
    xhr.addEventListener("abort", () => {
      watchdog.stop();
      // The watchdog itself rejects on stall-abort; this only fires
      // for an external abort (e.g. user navigated away).
      reject(new Error("Upload aborted"));
    });
    xhr.addEventListener("timeout", () => {
      watchdog.stop();
      // Surfaces as a network-style error so the retry wrapper picks it up.
      reject(new Error("Network error during upload (timeout)"));
    });

    onProgress(2, "Starting upload…");
    watchdog.start();
    xhr.send(file);
  });
}

// ── Multipart R2 (large files) ───────────────────────────────────────

/**
 * S3 multipart upload to R2. Used for files larger than
 * `R2_MULTIPART_THRESHOLD_BYTES`. Each 8 MB part is signed
 * independently and uploaded in its own XHR PUT, so a stalled part
 * only re-uploads that 8 MB instead of the whole file.
 *
 * Flow:
 *   1. Ask `/api/blob/r2-multipart` (`action: "start"`) → `{ uploadId, key }`.
 *   2. For each part:
 *        a. `action: "sign-part"` → presigned PUT URL.
 *        b. XHR PUT the chunk; up to 3 retries on network error / 5xx.
 *        c. Extract `ETag` response header → record it.
 *   3. `action: "complete"` with all part etags → final object URL.
 *
 * On hard client failure we fire-and-forget `action: "abort"` so the
 * in-flight upload doesn't sit there billing R2 storage forever.
 */
async function uploadMultipartToR2(
  file: File,
  init: InitR2Multipart,
  onProgress: UploadProgress
): Promise<string> {
  onProgress(2, "Starting multipart upload…");

  // ── Step 1: start ────────────────────────────────────────────────
  const startRes = await fetch("/api/blob/r2-multipart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start", pathname: init.pathname, admin: true }),
  });
  if (!startRes.ok) {
    const err = await startRes.json().catch(() => ({}));
    throw new Error(err.error || `Multipart start failed (${startRes.status})`);
  }
  const { uploadId, key } = (await startRes.json()) as {
    uploadId: string;
    key: string;
  };

  const totalParts = Math.max(1, Math.ceil(file.size / PART_SIZE));
  const completedParts: { partNumber: number; etag: string }[] = [];
  // Per-part loaded byte counters keyed by partNumber. Total bytes
  // uploaded across the file is the sum, used for the aggregate %
  // and the bytes column.
  const partLoaded = new Map<number, number>();

  function totalLoadedBytes(): number {
    let sum = 0;
    partLoaded.forEach((n) => {
      sum += n;
    });
    return sum;
  }

  try {
    for (let i = 0; i < totalParts; i++) {
      const partNumber = i + 1;
      const start = i * PART_SIZE;
      const end = Math.min(start + PART_SIZE, file.size);
      const chunk = file.slice(start, end);

      const etag = await uploadOnePartWithRetry({
        partNumber,
        totalParts,
        chunk,
        key,
        uploadId,
        fileSize: file.size,
        onProgress,
        onPartLoaded: (loaded) => {
          partLoaded.set(partNumber, loaded);
          const loadedTotal = totalLoadedBytes();
          const pct =
            Math.round((loadedTotal / file.size) * 88) + 2;
          onProgress(
            pct,
            `Uploading… ${pct}% (part ${partNumber}/${totalParts})`,
            { loaded: loadedTotal, total: file.size }
          );
        },
      });
      // Lock in the part's bytes once it succeeds — XHR progress can
      // briefly overshoot the slice size on some browsers.
      partLoaded.set(partNumber, end - start);
      completedParts.push({ partNumber, etag });
    }

    // ── Step 3: complete ──────────────────────────────────────────
    onProgress(92, "Finishing upload (combining parts)…");
    const completeRes = await fetch("/api/blob/r2-multipart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "complete",
        uploadId,
        key,
        parts: completedParts,
        admin: true,
      }),
    });
    if (!completeRes.ok) {
      const err = await completeRes.json().catch(() => ({}));
      throw new Error(
        err.error || `Multipart complete failed (${completeRes.status})`
      );
    }
    const { url } = (await completeRes.json()) as { url: string };
    return url || init.objectUrl;
  } catch (e) {
    // Fire-and-forget abort so R2 doesn't keep billing for the
    // in-flight upload. We don't await the result of this — if it
    // fails the upload will auto-expire eventually anyway, and the
    // user already saw the original error.
    fetch("/api/blob/r2-multipart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "abort",
        uploadId,
        key,
        admin: true,
      }),
    }).catch(() => {});
    throw e;
  }
}

interface UploadOnePartArgs {
  partNumber: number;
  totalParts: number;
  chunk: Blob;
  key: string;
  uploadId: string;
  fileSize: number;
  onProgress: UploadProgress;
  onPartLoaded: (loaded: number) => void;
}

async function uploadOnePartWithRetry(args: UploadOnePartArgs): Promise<string> {
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [1_000, 3_000];
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      args.onProgress(
        0,
        `──── Part ${args.partNumber}/${args.totalParts} attempt ${attempt}/${MAX_ATTEMPTS} ────`
      );
    }
    try {
      // Mint a fresh signed URL on every attempt. The first URL might be
      // close to expiry on a slow upload; re-minting is cheap.
      const signRes = await fetch("/api/blob/r2-multipart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sign-part",
          uploadId: args.uploadId,
          key: args.key,
          partNumber: args.partNumber,
          admin: true,
        }),
      });
      if (!signRes.ok) {
        const err = await signRes.json().catch(() => ({}));
        throw new Error(
          err.error || `Sign-part failed (${signRes.status})`
        );
      }
      const { uploadUrl } = (await signRes.json()) as { uploadUrl: string };

      return await uploadOnePart({
        ...args,
        uploadUrl,
      });
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      const retryable = isRetryableUploadError(lastErr);
      if (!retryable || attempt === MAX_ATTEMPTS) throw lastErr;
      const wait = BACKOFF_MS[attempt - 1] ?? 5_000;
      args.onProgress(
        0,
        `Retrying part ${args.partNumber}/${args.totalParts} (attempt ${
          attempt + 1
        }/${MAX_ATTEMPTS} after ${Math.round(wait / 1000)}s)…`
      );
      // Reset this part's byte counter — the in-progress upload was
      // discarded, so don't keep counting its abandoned bytes.
      args.onPartLoaded(0);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr ?? new Error("Part upload failed after retries");
}

function uploadOnePart(
  args: UploadOnePartArgs & { uploadUrl: string }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", args.uploadUrl, true);
    // No Content-Type header on part PUTs — UploadPart doesn't require
    // it and setting one can mismatch the signature in some SDK versions.
    xhr.timeout = 0;

    const watchdog = createStallWatchdog({
      label: `part ${args.partNumber}`,
      onWarn: (state) => {
        args.onProgress(
          state.pct,
          `Stalled — no upload progress for ${Math.round(STALL_WARN_MS / 1000)}s ` +
            `on part ${args.partNumber}/${args.totalParts} ` +
            `(${fmtBytesPair(state.loaded, state.total)})`
        );
      },
      onAbort: (state) => {
        try {
          xhr.abort();
        } catch {
          // ignore
        }
        reject(
          new Error(
            `Network error during upload (part ${args.partNumber} stalled — no progress for ${Math.round(
              STALL_ABORT_MS / 1000
            )}s at ${state.pct}%)`
          )
        );
      },
    });

    xhr.upload.addEventListener("progress", (ev) => {
      if (!ev.lengthComputable) return;
      // Aggregate progress is tracked by the caller via onPartLoaded.
      // The watchdog tracks per-part pct so the "stalled" message
      // shows part-relative position.
      const partPct = Math.round((ev.loaded / ev.total) * 100);
      watchdog.notifyProgress(partPct, ev.loaded, ev.total);
      args.onPartLoaded(ev.loaded);
    });

    xhr.addEventListener("load", () => {
      watchdog.stop();
      if (xhr.status >= 200 && xhr.status < 300) {
        // ETag comes back as a quoted string ("…"). The S3
        // CompleteMultipartUpload API actually wants it quoted, but
        // both quoted and unquoted are accepted in practice — and the
        // AWS SDK on the server normalises it. We keep whatever the
        // header returned, just trimmed.
        const etag = (xhr.getResponseHeader("ETag") ?? "").trim();
        if (!etag) {
          reject(
            new Error(
              `Upload failed (no ETag in response for part ${args.partNumber})`
            )
          );
          return;
        }
        resolve(etag);
      } else {
        reject(
          new Error(
            `Upload failed (${xhr.status}): ${xhr.responseText.slice(0, 200)}`
          )
        );
      }
    });
    xhr.addEventListener("error", () => {
      watchdog.stop();
      reject(new Error("Network error during upload"));
    });
    xhr.addEventListener("abort", () => {
      watchdog.stop();
      reject(new Error("Upload aborted"));
    });
    xhr.addEventListener("timeout", () => {
      watchdog.stop();
      reject(new Error("Network error during upload (timeout)"));
    });

    watchdog.start();
    xhr.send(args.chunk);
  });
}

// ── Stall watchdog ───────────────────────────────────────────────────

interface StallWatchdog {
  start(): void;
  stop(): void;
  notifyProgress(pct: number, loaded: number, total: number): void;
}

interface StallWatchdogOpts {
  label: string;
  onWarn: (state: { pct: number; loaded: number; total: number }) => void;
  onAbort: (state: { pct: number; loaded: number; total: number }) => void;
}

/**
 * Watches an XHR upload for "no progress events fired in the last N
 * seconds" and reports / aborts when the threshold is crossed. The
 * watchdog must NOT fire after the upload completes, errors out, or
 * is aborted externally — `stop()` clears the timer and the
 * `stopped` flag prevents the warn/abort callbacks from firing if
 * the timer is still mid-tick when `stop()` is called.
 *
 * The watchdog only counts "in-flight" progress (1%..99%). It
 * doesn't warn before the upload has started moving (no progress
 * event has fired yet) and it doesn't warn at the very end (100%
 * uploaded — waiting for server response is normal). 100% with no
 * server response after 60s falls back to the XHR's own error/timeout
 * path.
 */
function createStallWatchdog(opts: StallWatchdogOpts): StallWatchdog {
  let lastProgressTs = 0; // 0 = no progress event seen yet
  let lastPct = 0;
  let lastLoaded = 0;
  let lastTotal = 0;
  let warned = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      lastProgressTs = Date.now();
      timer = setInterval(() => {
        if (stopped) return;
        if (lastProgressTs === 0) return;
        // Only watch in the "interesting" range. Below 1% the upload
        // hasn't really started moving (TCP handshake / first part
        // ack); at 100% we're waiting on the server response, which
        // can legitimately take time on a large body and is handled
        // by xhr.error / xhr.timeout instead.
        if (lastPct < 1 || lastPct > 99) return;

        const elapsed = Date.now() - lastProgressTs;
        if (elapsed >= STALL_ABORT_MS) {
          stopped = true;
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          opts.onAbort({
            pct: lastPct,
            loaded: lastLoaded,
            total: lastTotal,
          });
          return;
        }
        if (elapsed >= STALL_WARN_MS && !warned) {
          warned = true;
          opts.onWarn({
            pct: lastPct,
            loaded: lastLoaded,
            total: lastTotal,
          });
        }
      }, 1_000);
    },
    stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    notifyProgress(pct, loaded, total) {
      lastProgressTs = Date.now();
      lastPct = pct;
      lastLoaded = loaded;
      lastTotal = total;
      warned = false;
    },
  };
}

// ── Vercel Blob multipart (unchanged) ────────────────────────────────

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

// ── Formatting helpers ───────────────────────────────────────────────

function fmtBytesPair(loaded: number, total: number): string {
  return `${fmtMB(loaded)} / ${fmtMB(total)}`;
}

function fmtMB(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}
