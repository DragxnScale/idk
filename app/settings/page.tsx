"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getPdfZoom, setPdfZoom } from "@/lib/prefs";

const ZOOM_PRESETS = [
  { label: "Small", value: 0.75 },
  { label: "Normal", value: 1 },
  { label: "Large", value: 1.25 },
  { label: "Extra Large", value: 1.5 },
];

export default function SettingsPage() {
  const [zoom, setZoomState] = useState(1);

  useEffect(() => {
    setZoomState(getPdfZoom());
  }, []);

  function handleZoomChange(value: number) {
    setZoomState(value);
    setPdfZoom(value);
    // Notify any open PdfViewer tabs
    window.dispatchEvent(new StorageEvent("storage", { key: "studyfocus-pdf-zoom" }));
  }

  const [currentPassword, setCurrentPassword] = useState("");
  const [newExitPassword, setNewExitPassword] = useState("");
  const [confirmExitPassword, setConfirmExitPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (newExitPassword !== confirmExitPassword) {
      setStatus("error");
      setMessage("New passwords don't match.");
      return;
    }
    if (newExitPassword.length < 4) {
      setStatus("error");
      setMessage("Exit password must be at least 4 characters.");
      return;
    }

    setStatus("loading");
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newExitPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus("success");
        setMessage("Exit password updated.");
        setCurrentPassword("");
        setNewExitPassword("");
        setConfirmExitPassword("");
      } else {
        setStatus("error");
        setMessage(data.error ?? "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto max-w-lg px-6 py-10">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-black dark:hover:text-white underline underline-offset-4"
          >
            ← Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>

        {/* Textbook display size */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900 mb-4">
          <h2 className="text-base font-semibold mb-1">Textbook display size</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
            Controls how large the PDF pages appear while reading. Saved on
            this device.
          </p>
          <div className="grid grid-cols-4 gap-2">
            {ZOOM_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => handleZoomChange(preset.value)}
                className={`rounded-lg border py-3 text-sm font-medium transition ${
                  zoom === preset.value
                    ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-gray-300 hover:border-gray-400 dark:border-gray-600"
                }`}
              >
                {preset.label}
                <span className="block text-xs opacity-60 mt-0.5">
                  {Math.round(preset.value * 100)}%
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Exit password section */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="text-base font-semibold mb-1">Exit password</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
            This password is required to end a study session early, keeping you
            accountable. By default it&apos;s the same as your login password.
            Change it here if you want a different one.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Current login password
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Your login password"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                New exit password
              </label>
              <input
                type="password"
                value={newExitPassword}
                onChange={(e) => setNewExitPassword(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="At least 4 characters"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Confirm new exit password
              </label>
              <input
                type="password"
                value={confirmExitPassword}
                onChange={(e) => setConfirmExitPassword(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="Repeat new exit password"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
              />
            </div>

            {message && (
              <p
                className={`text-sm ${
                  status === "success"
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={status === "loading"}
              className="w-full rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {status === "loading" ? "Saving…" : "Save exit password"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
