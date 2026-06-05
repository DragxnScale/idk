"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

/**
 * Pre-review configuration screen for `/review`.
 *
 * Renders a form letting the user pick:
 *
 *   - **What cards to feature** (`mode`): "due", "all", "new", "review",
 *     or "leeches". Default `due` mirrors the dashboard's auto-fetch
 *     behavior so the home screen's first-render is the same set of
 *     cards the user expected.
 *   - **Decks**: which textbook(s) / PDF(s) the cards come from.
 *     Multi-select; "all" toggles every deck in / out.
 *   - **Maximum age**: only include cards created within the last N
 *     days. "All time" disables the filter.
 *   - **Limit**: how many cards to load into one session. Default
 *     "no limit" (server enforces a 1000-row safety ceiling). Daily
 *     caps from settings are bypassed when the user explicitly picks
 *     a non-`due` mode — they asked for "everything".
 *
 * Submits by calling the parent's `onStart(config)` — the parent
 * (`app/review/page.tsx`) swaps this component for `ReviewSession`
 * with the chosen config. No router push so the browser back button
 * returns the user to the home screen with their selections intact.
 */

export interface ReviewConfig {
  mode: "due" | "all" | "new" | "review" | "leeches";
  deckKeys: string[]; // empty = all decks
  maxAgeDays: number; // 0 = no age filter
  limit: number; // 0 = no limit (server caps at 1000)
}

interface DecksResponse {
  decks: {
    deckKey: string;
    deckTitle: string;
    cardCount: number;
    dueCount: number;
    newCount: number;
    oldestCardAt: number | null;
  }[];
  totalCards: number;
  totalDue: number;
  totalNew: number;
  oldestCardAt: number | null;
}

interface ReviewHomeProps {
  onStart: (config: ReviewConfig) => void;
}

const MODE_OPTIONS: {
  value: ReviewConfig["mode"];
  label: string;
  description: string;
}[] = [
  {
    value: "due",
    label: "Due now",
    description: "Cards your schedule says it's time to see.",
  },
  {
    value: "all",
    label: "Everything",
    description: "Walk every card in your collection regardless of schedule.",
  },
  {
    value: "new",
    label: "New only",
    description: "Cards you've never reviewed yet.",
  },
  {
    value: "review",
    label: "Mature only",
    description: "Cards already in the spaced rotation, no new ones.",
  },
  {
    value: "leeches",
    label: "Leeches",
    description: "Cards you've gotten wrong 3+ times — drill the hard ones.",
  },
];

const AGE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "All time" },
  { value: 7, label: "Past 7 days" },
  { value: 14, label: "Past 2 weeks" },
  { value: 30, label: "Past month" },
  { value: 90, label: "Past 3 months" },
  { value: 365, label: "Past year" },
];

export function ReviewHome({ onStart }: ReviewHomeProps) {
  const [data, setData] = useState<DecksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<ReviewConfig["mode"]>("due");
  // null = all decks (default). Otherwise an explicit subset.
  const [selectedDecks, setSelectedDecks] = useState<Set<string> | null>(null);
  const [maxAgeDays, setMaxAgeDays] = useState<number>(0);
  const [limitMode, setLimitMode] = useState<"none" | "custom">("none");
  const [limitValue, setLimitValue] = useState<string>("50");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/review/decks", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`decks: ${r.status}`);
        return r.json() as Promise<DecksResponse>;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e?.message ?? e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const allDeckKeys = useMemo(
    () => (data ? data.decks.map((d) => d.deckKey) : []),
    [data]
  );

  const isAllSelected = selectedDecks === null;

  const toggleDeck = (key: string) => {
    setSelectedDecks((prev) => {
      // First click on a single deck while "all" is selected: switch
      // to that deck only. Subsequent clicks add/remove individuals.
      if (prev === null) {
        const allButThis = new Set(allDeckKeys.filter((k) => k !== key));
        return allButThis;
      }
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      // If they ended up with everything checked again, snap back to
      // "all" so the URL stays clean and re-renders show the "All
      // decks" highlight rather than enumerating every key.
      if (next.size === allDeckKeys.length) return null;
      // If they unchecked everything, snap back to "all" — empty
      // selection would yield zero results, which is hostile UX.
      if (next.size === 0) return null;
      return next;
    });
  };

  const selectAllDecks = () => setSelectedDecks(null);

  const cardCountForMode = useMemo(() => {
    if (!data) return 0;
    const decksInScope =
      isAllSelected
        ? data.decks
        : data.decks.filter((d) => selectedDecks!.has(d.deckKey));
    if (mode === "due") {
      return decksInScope.reduce((s, d) => s + d.dueCount, 0);
    }
    if (mode === "new") {
      return decksInScope.reduce((s, d) => s + d.newCount, 0);
    }
    // For all / review / leeches we don't have per-deck precomputed
    // counts here; surface the total card count instead. The user
    // sees the exact queue size on the next screen.
    return decksInScope.reduce((s, d) => s + d.cardCount, 0);
  }, [data, mode, isAllSelected, selectedDecks]);

  const oldestLabel = useMemo(() => {
    if (!data?.oldestCardAt) return null;
    return new Date(data.oldestCardAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [data]);

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    let limit = 0;
    if (limitMode === "custom") {
      const n = Number(limitValue);
      limit = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 50;
    }
    onStart({
      mode,
      deckKeys: isAllSelected ? [] : Array.from(selectedDecks!),
      maxAgeDays,
      limit,
    });
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-gray-500">Loading your decks…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="mb-2 text-xl font-semibold">Couldn&apos;t load decks</h1>
        <p className="mb-4 text-sm text-red-500">{error}</p>
        <Link
          href="/dashboard"
          className="inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  if (!data || data.totalCards === 0) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <h1 className="mb-2 text-2xl font-semibold">No flashcards yet</h1>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
          Generate flashcards from the AI tab on any study session
          summary, then come back here to review them.
        </p>
        <Link
          href="/dashboard"
          className="inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white"
        >
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
          >
            ← Dashboard
          </Link>
          <p className="text-xs text-gray-500">
            {data.totalCards} card{data.totalCards === 1 ? "" : "s"} ·{" "}
            {data.totalDue} due
            {oldestLabel ? ` · since ${oldestLabel}` : ""}
          </p>
        </div>
      </div>

      <form onSubmit={handleStart} className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-semibold">Review flashcards</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Pick what you want to study, then start.
          </p>
        </div>

        {/* What cards to feature */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-3 text-sm font-semibold">What to feature</h2>
          <div className="grid gap-2">
            {MODE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                  mode === opt.value
                    ? "border-accent bg-accent/5"
                    : "border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600"
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  value={opt.value}
                  checked={mode === opt.value}
                  onChange={() => setMode(opt.value)}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {opt.description}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* Decks */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Subjects / PDFs</h2>
            <button
              type="button"
              onClick={selectAllDecks}
              disabled={isAllSelected}
              className="text-xs text-accent disabled:text-gray-400"
            >
              Select all
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.decks.map((deck) => {
              const checked =
                isAllSelected || (selectedDecks?.has(deck.deckKey) ?? false);
              return (
                <label
                  key={deck.deckKey}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${
                    checked
                      ? "border-accent bg-accent/5"
                      : "border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleDeck(deck.deckKey)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {deck.deckTitle}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {deck.cardCount} card{deck.cardCount === 1 ? "" : "s"}
                      {deck.dueCount > 0 && ` · ${deck.dueCount} due`}
                      {deck.newCount > 0 && ` · ${deck.newCount} new`}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        </section>

        {/* Maximum age */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-1 text-sm font-semibold">Maximum age</h2>
          <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
            Only include cards added within this window.
          </p>
          <div className="flex flex-wrap gap-2">
            {AGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMaxAgeDays(opt.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  maxAgeDays === opt.value
                    ? "border-accent bg-accent text-white"
                    : "border-gray-300 text-gray-700 hover:border-gray-400 dark:border-gray-600 dark:text-gray-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Limit */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="mb-1 text-sm font-semibold">Limit</h2>
          <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
            Cap this session at a fixed number of cards. Default is no
            limit so you keep going until the queue empties.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="limit"
                checked={limitMode === "none"}
                onChange={() => setLimitMode("none")}
              />
              <span className="text-sm">No limit</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="limit"
                checked={limitMode === "custom"}
                onChange={() => setLimitMode("custom")}
              />
              <span className="text-sm">At most</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={limitValue}
                onChange={(e) => {
                  setLimitValue(e.target.value);
                  if (limitMode !== "custom") setLimitMode("custom");
                }}
                className="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700"
              />
              <span className="text-sm text-gray-500">cards</span>
            </label>
          </div>
        </section>

        {/* Submit */}
        <div className="sticky bottom-4 mt-8">
          <button
            type="submit"
            className="btn-primary w-full rounded-xl px-5 py-3 text-sm font-semibold"
          >
            Start review
            {cardCountForMode > 0 && (
              <span className="ml-2 text-xs opacity-80">
                · {cardCountForMode} card{cardCountForMode === 1 ? "" : "s"}{mode === "due" ? " due" : ""}
              </span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
