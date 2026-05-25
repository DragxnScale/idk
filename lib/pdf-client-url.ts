/**
 * URL to load a PDF in the browser (react-pdf, iframe) with same-origin cookies.
 *
 * - Vercel Blob URLs (private or public) must use `/api/blob/serve` so the
 *   server attaches `BLOB_READ_WRITE_TOKEN`; raw blob URLs return HTML/403
 *   for private content and break WebKit's PDF plug-in / pdf.js.
 * - Cloudflare R2 URLs always require SigV4 auth on the GET, so they also
 *   route through `/api/blob/serve`.
 * - Anything else falls back to `/api/proxy/pdf` (allowlisted external hosts).
 */
export function pdfClientLoadUrl(pdfUrl: string): string {
  if (!pdfUrl.startsWith("http")) return pdfUrl;
  if (
    pdfUrl.includes("blob.vercel-storage.com") ||
    pdfUrl.includes(".r2.cloudflarestorage.com")
  ) {
    return `/api/blob/serve?url=${encodeURIComponent(pdfUrl)}`;
  }
  return `/api/proxy/pdf?url=${encodeURIComponent(pdfUrl)}`;
}
