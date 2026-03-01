const PDF_ZOOM_KEY = "studyfocus-pdf-zoom";
const DEFAULT_ZOOM = 1;

export function getPdfZoom(): number {
  if (typeof window === "undefined") return DEFAULT_ZOOM;
  const raw = localStorage.getItem(PDF_ZOOM_KEY);
  const parsed = raw ? parseFloat(raw) : NaN;
  return isNaN(parsed) ? DEFAULT_ZOOM : Math.min(2, Math.max(0.5, parsed));
}

export function setPdfZoom(zoom: number): void {
  localStorage.setItem(PDF_ZOOM_KEY, String(zoom));
}
