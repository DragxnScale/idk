import BookFlipCanvas from "@/components/landing/BookFlipCanvas";

/**
 * Standalone preview for the canvas book-flip hero visual.
 * Visit /book-flip-preview to iterate before wiring into HomeLanding.
 */
export default function BookFlipPreviewPage() {
  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center gap-6 p-8">
      <p className="text-white/50 text-sm">
        Canvas book-flip dev preview (same component as the landing hero).
      </p>
      <BookFlipCanvas reducedMotion={false} />
    </main>
  );
}
