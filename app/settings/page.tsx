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
  // ── PDF zoom ────────────────────────────────────────────────────────
  const [zoom, setZoomState] = useState(1);

  useEffect(() => {
    setZoomState(getPdfZoom());
  }, []);

  function handleZoomChange(value: number) {
    setZoomState(value);
    setPdfZoom(value);
    window.dispatchEvent(new StorageEvent("storage", { key: "studyfocus-pdf-zoom" }));
  }

  // ── Daily goals ─────────────────────────────────────────────────────
  const [minutesGoal, setMinutesGoal] = useState<string>("");
  const [sessionsGoal, setSessionsGoal] = useState<string>("");
  const [goalsStatus, setGoalsStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [goalsMessage, setGoalsMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/user/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setMinutesGoal(data.dailyMinutesGoal != null ? String(data.dailyMinutesGoal) : "");
        setSessionsGoal(data.dailySessionsGoal != null ? String(data.dailySessionsGoal) : "");
      });
  }, []);

  async function handleGoalsSave(e: React.FormEvent) {
    e.preventDefault();
    setGoalsStatus("loading");
    setGoalsMessage(null);
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyMinutesGoal: minutesGoal === "" ? 0 : Number(minutesGoal),
          dailySessionsGoal: sessionsGoal === "" ? 0 : Number(sessionsGoal),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setGoalsStatus("success");
        setGoalsMessage("Daily goals saved.");
      } else {
        setGoalsStatus("error");
        setGoalsMessage(data.error ?? "Something went wrong.");
      }
    } catch {
      setGoalsStatus("error");
      setGoalsMessage("Network error. Please try again.");
    }
  }

  // ── Exit password ───────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState("");
  const [newExitPassword, setNewExitPassword] = useState("");
  const [confirmExitPassword, setConfirmExitPassword] = useState("");
  const [pwStatus, setPwStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [pwMessage, setPwMessage] = useState<string | null>(null);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwMessage(null);
    if (newExitPassword !== confirmExitPassword) {
      setPwStatus("error");
      setPwMessage("New passwords don't match.");
      return;
    }
    if (newExitPassword.length < 4) {
      setPwStatus("error");
      setPwMessage("Exit password must be at least 4 characters.");
      return;
    }
    setPwStatus("loading");
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newExitPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPwStatus("success");
        setPwMessage("Exit password updated.");
        setCurrentPassword("");
        setNewExitPassword("");
        setConfirmExitPassword("");
      } else {
        setPwStatus("error");
        setPwMessage(data.error ?? "Something went wrong.");
      }
    } catch {
      setPwStatus("error");
      setPwMessage("Network error. Please try again.");
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto max-w-lg px-6 py-10 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-4 mb-4">
          <Link
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-black dark:hover:text-white underline underline-offset-4"
          >
            ← Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>

        {/* Daily goals */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="text-base font-semibold mb-1">Daily goals</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
            Set targets for each day. Your progress towards these will be
            shown on the dashboard. Leave a field blank to disable that goal.
          </p>
          <form onSubmit={handleGoalsSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Minutes per day
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={minutesGoal}
                    onChange={(e) => { setMinutesGoal(e.target.value); setGoalsStatus("idle"); }}
                    placeholder="e.g. 60"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                    min
                  </span>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Sessions per day
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={sessionsGoal}
                    onChange={(e) => { setSessionsGoal(e.target.value); setGoalsStatus("idle"); }}
                    placeholder="e.g. 2"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                    sessions
                  </span>
                </div>
              </div>
            </div>

            {goalsMessage && (
              <p className={`text-sm ${goalsStatus === "success" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {goalsMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={goalsStatus === "loading"}
              className="w-full rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {goalsStatus === "loading" ? "Saving…" : "Save goals"}
            </button>
          </form>
        </section>

        {/* Textbook display size */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
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

        {/* Exit password */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="text-base font-semibold mb-1">Exit password</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
            Required to end a study session early. Defaults to your login
            password if not changed.
          </p>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
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
            {pwMessage && (
              <p className={`text-sm ${pwStatus === "success" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                {pwMessage}
              </p>
            )}
            <button
              type="submit"
              disabled={pwStatus === "loading"}
              className="w-full rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {pwStatus === "loading" ? "Saving…" : "Save exit password"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
