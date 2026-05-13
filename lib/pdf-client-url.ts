/**
 * URL to load a PDF in the browser (react-pdf, iframe) with same-origin cookies.
 * Vercel Blob URLs (including private) must use `/api/blob/serve` so the server
 * attaches `BLOB_READ_WRITE_TOKEN`; raw blob URLs return HTML/403 and break
 * WebKit's PDF plug-in and pdf.js.
 */
export function pdfClientLoadUrl(pdfUrl: string): string {
  if (!pdfUrl.startsWith("http")) return pdfUrl;
  if (pdfUrl.includes("blob.vercel-storage.com")) {
    return `/api/blob/serve?url=${encodeURIComponent(pdfUrl)}`;
  }
  return `/api/proxy/pdf?url=${encodeURIComponent(pdfUrl)}`;
}
