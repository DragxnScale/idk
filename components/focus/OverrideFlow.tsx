"use client";

import { useRef, useState } from "react";

interface OverrideFlowProps {
  onConfirmEnd: () => void;
}

export function OverrideFlow({ onConfirmEnd }: OverrideFlowProps) {
  const [showBar, setShowBar] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function open() {
    setShowBar(true);
    setPassword("");
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function close() {
    setShowBar(false);
    setPassword("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify-exit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        close();
        onConfirmEnd();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Incorrect password");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="rounded border border-red-500/40 px-3 py-1.5 text-sm text-red-600 dark:text-red-400"
      >
        I need to stop
      </button>

      {showBar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
            <h2 className="text-base font-semibold mb-1">End session?</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Enter your exit password to stop. Progress will be saved.
            </p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                ref={inputRef}
                type="password"
                placeholder="Exit password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                autoComplete="current-password"
              />
              {error && (
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={close}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600"
                >
                  Keep studying
                </button>
                <button
                  type="submit"
                  disabled={verifying || !password}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {verifying ? "Checking…" : "End session"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
