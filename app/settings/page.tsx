"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getPdfZoom, setPdfZoom } from "@/lib/prefs";
import { THEMES, getThemeById } from "@/lib/themes";

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
  const [inactivityMin, setInactivityMin] = useState<string>("");
  const [goalsStatus, setGoalsStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [goalsMessage, setGoalsMessage] = useState<string | null>(null);

  // ── Theme ──────────────────────────────────────────────────────────
  const [themeId, setThemeId] = useState<string>("default");
  const [themeSaving, setThemeSaving] = useState(false);

  // ── Focus music URL (localStorage) ────────────────────────────────
  const [musicUrl, setMusicUrl] = useState("");
  useEffect(() => {
    setMusicUrl(localStorage.getItem("studyfocus-music-url") ?? "");
  }, []);

  useEffect(() => {
    fetch("/api/user/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setMinutesGoal(data.dailyMinutesGoal != null ? String(data.dailyMinutesGoal) : "");
        setSessionsGoal(data.dailySessionsGoal != null ? String(data.dailySessionsGoal) : "");
        setInactivityMin(data.inactivityTimeout != null ? String(data.inactivityTimeout) : "");
        if (data.themeId) setThemeId(data.themeId);
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
          inactivityTimeout: inactivityMin === "" ? 0 : Number(inactivityMin),
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

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Inactivity timeout
              </label>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">
                Pause timer &amp; ask if you&apos;re still reading after this many minutes of no interaction. Leave blank for default (3 min).
              </p>
              <div className="relative w-40">
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={inactivityMin}
                  onChange={(e) => { setInactivityMin(e.target.value); setGoalsStatus("idle"); }}
                  placeholder="3"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                  min
                </span>
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

        {/* Focus music */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="text-base font-semibold mb-1">Focus music</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
            Play background music during study sessions. Paste a URL to any audio
            stream, YouTube video, or search for something below. Saved on this device.
          </p>
          <div className="space-y-3">
            <input
              type="url"
              value={musicUrl}
              onChange={(e) => {
                setMusicUrl(e.target.value);
                localStorage.setItem("studyfocus-music-url", e.target.value);
              }}
              placeholder="https://youtube.com/watch?v=... or audio URL"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
            />
            <div className="flex gap-2 flex-wrap">
              {["lofi hip hop", "study music", "rain sounds", "classical piano", "white noise"].map((q) => (
                <a
                  key={q}
                  href={`https://www.youtube.com/results?search_query=${encodeURIComponent(q + " study")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-gray-300 px-3 py-1 text-xs hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800 transition"
                >
                  {q}
                </a>
              ))}
            </div>
            {musicUrl && (
              <button
                onClick={() => {
                  setMusicUrl("");
                  localStorage.removeItem("studyfocus-music-url");
                }}
                className="text-xs text-red-500 hover:underline"
              >
                Clear saved URL
              </button>
            )}
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

        {/* Custom theme */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="text-base font-semibold mb-1">Theme</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
            Pick a color theme for the app. This applies to your account across devices.
          </p>
          <div className="grid grid-cols-4 gap-2">
            {THEMES.map((t) => {
              const isActive = themeId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={async () => {
                    setThemeId(t.id);
                    setThemeSaving(true);
                    try {
                      await fetch("/api/user/settings", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ themeId: t.id }),
                      });
                      document.documentElement.setAttribute("data-theme", t.id);
                      localStorage.setItem("studyfocus-theme", t.id);
                    } finally {
                      setThemeSaving(false);
                    }
                  }}
                  disabled={themeSaving}
                  className={`rounded-lg border py-2.5 text-xs font-medium transition ${
                    isActive
                      ? "border-black ring-2 ring-black/20 dark:border-white dark:ring-white/20"
                      : "border-gray-300 hover:border-gray-400 dark:border-gray-600"
                  }`}
                >
                  <div className="flex justify-center gap-1 mb-1.5">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.primary }} />
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.accent }} />
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.bg, border: "1px solid #d1d5db" }} />
                  </div>
                  {t.name}
                </button>
              );
            })}
          </div>
        </section>

        {/* Keyboard shortcuts reference */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <h2 className="text-base font-semibold mb-1">Keyboard shortcuts</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
            Available while reading in a study session.
          </p>
          <div className="space-y-2">
            {[
              ["←  →", "Previous / Next page"],
              ["B", "Toggle bookmark on current page"],
              ["F", "Open / close search"],
              ["Esc", "Close search, TOC, or bookmarks panel"],
              ["Ctrl + scroll", "Zoom in / out"],
              ["Pinch", "Zoom on touch devices"],
            ].map(([key, desc]) => (
              <div key={key} className="flex items-center gap-3">
                <kbd className="inline-block min-w-[3.5rem] text-center rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs font-mono dark:border-gray-600 dark:bg-gray-800">
                  {key}
                </kbd>
                <span className="text-sm text-gray-600 dark:text-gray-400">{desc}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
