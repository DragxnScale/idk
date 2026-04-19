"use client";

import { useState, useCallback } from "react";

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  pageNumber: number | null;
}

interface FlashcardViewProps {
  cards: Flashcard[];
}

export function FlashcardView({ cards: initialCards }: FlashcardViewProps) {
  const [cards, setCards] = useState(initialCards);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const current = cards[index];

  const go = useCallback((dir: 1 | -1) => {
    setFlipped(false);
    setIndex((i) => {
      const next = i + dir;
      if (next < 0) return cards.length - 1;
      if (next >= cards.length) return 0;
      return next;
    });
  }, [cards.length]);

  const shuffle = useCallback(() => {
    setFlipped(false);
    setIndex(0);
    setCards((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    });
  }, []);

  if (!current) return null;

  return (
    <div className="space-y-4">
      {/* Counter + shuffle */}
      <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
        <span>{index + 1} / {cards.length} cards</span>
        <button
          onClick={shuffle}
          className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800 transition"
        >
          Shuffle
        </button>
      </div>

      {/* Flip card */}
      <div
        className="relative cursor-pointer select-none"
        style={{ perspective: "1200px", minHeight: "200px" }}
        onClick={() => setFlipped((f) => !f)}
      >
        <div
          className="relative w-full transition-transform duration-500"
          style={{
            transformStyle: "preserve-3d",
            transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
            minHeight: "200px",
          }}
        >
          {/* Front */}
          <div
            className="absolute inset-0 rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 flex flex-col items-center justify-center p-8 text-center"
            style={{ backfaceVisibility: "hidden" }}
          >
            {current.pageNumber != null && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-3 absolute top-4 left-4">
                p. {current.pageNumber}
              </p>
            )}
            <p className="text-xs font-medium text-gray-400 dark:text-gray-500 mb-3 uppercase tracking-wide">Term</p>
            <p className="text-lg font-semibold leading-snug">{current.front}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">Tap to reveal</p>
          </div>

          {/* Back */}
          <div
            className="absolute inset-0 rounded-2xl border border-accent bg-accent/5 dark:bg-accent/10 flex flex-col items-center justify-center p-8 text-center"
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
          >
            <p className="text-xs font-medium text-accent mb-3 uppercase tracking-wide">Definition</p>
            <p className="text-sm leading-relaxed">{current.back}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">Tap to flip back</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex gap-3">
        <button
          onClick={() => go(-1)}
          className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800 transition"
        >
          ← Previous
        </button>
        <button
          onClick={() => go(1)}
          className="flex-1 btn-primary rounded-lg py-2.5 text-sm font-medium"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
