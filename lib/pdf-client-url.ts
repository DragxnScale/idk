/**
 * URL to load a PDF in the browser (react-pdf, iframe) with same-origin cookies.
 *
 * Routing rules:
 *   1. URL already on the public R2 base (`NEXT_PUBLIC_R2_PUBLIC_BASE_URL`) →
 *      return as-is. The browser fetches direct from R2's edge, no Vercel hop.
 *   2. R2 endpoint URL (SigV4-authenticated) → `/api/blob/serve`. That route
 *      302-redirects: public keys to the public R2 URL, private keys to a
 *      1 h presigned GET URL. Either way the bytes flow R2 → browser, not
 *      through Vercel.
 *   3. Anything else (allowlisted external textbook hosts) → `/api/proxy/pdf`.
 */
export function pdfClientLoadUrl(pdfUrl: string): string {
  if (!pdfUrl.startsWith("http")) return pdfUrl;

  const publicBase = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
  if (publicBase && pdfUrl.startsWith(publicBase)) return pdfUrl;

  if (pdfUrl.includes(".r2.cloudflarestorage.com")) {
    return `/api/blob/serve?url=${encodeURIComponent(pdfUrl)}`;
  }

  return `/api/proxy/pdf?url=${encodeURIComponent(pdfUrl)}`;
}
