"use client";

import { useRef, useState } from "react";

interface ExitPhraseGateProps {
  phrase: string;
  token: string;
  sessionId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ExitPhraseGate({
  phrase,
  token,
  sessionId,
  onSuccess,
  onCancel,
}: ExitPhraseGateProps) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!typed.trim()) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch(`/api/study/sessions/${sessionId}/exit-phrase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, phrase: typed }),
      });
      if (res.ok) {
        onSuccess();
      } else {
        setError("Phrase doesn't match. Copy it exactly.");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Type this phrase exactly — including capitalization — to unlock the exit.
      </p>
      <p className="rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-center font-mono text-sm font-semibold select-all">
        {phrase}
      </p>
      <input
        ref={inputRef}
        type="text"
        value={typed}
        onChange={(e) => { setTyped(e.target.value); setError(null); }}
        onFocus={(e) => {
          e.target.readOnly = false;
        }}
        readOnly
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        name="exit-phrase-gate"
        placeholder="Type the phrase above"
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-mono dark:border-gray-600 dark:bg-gray-800"
      />
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600"
        >
          Keep studying
        </button>
        <button
          type="submit"
          disabled={verifying || !typed.trim()}
          className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {verifying ? "Checking…" : "End session"}
        </button>
      </div>
    </form>
  );
}
