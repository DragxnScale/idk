"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { getPdfZoom, setPdfZoom } from "@/lib/prefs";
import { THEMES, getThemeById, getCustomThemes, saveCustomThemes, buildCustomTheme, applyThemeCssVars, clearThemeCssVars } from "@/lib/themes";
import { loadPlaylist, savePlaylist, resolveYouTubeTitle, isYouTubeUrl, type MusicTrack } from "@/lib/music";

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
    window.dispatchEvent(new StorageEvent("storage", { key: "bowlbeacon-pdf-zoom" }));
  }

  // ── Daily goals ─────────────────────────────────────────────────────
  const [minutesGoal, setMinutesGoal] = useState<string>("");
  const [sessionsGoal, setSessionsGoal] = useState<string>("");
  const [inactivityMin, setInactivityMin] = useState<string>("");
  const [quizMin, setQuizMin] = useState<string>("");
  const [quizMax, setQuizMax] = useState<string>("");
  const [goalsStatus, setGoalsStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [goalsMessage, setGoalsMessage] = useState<string | null>(null);

  // ── Account details ────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState("");
  const [accountEmail, setAccountEmail] = useState(""); // kept for potential future use
  const [accountStatus, setAccountStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [accountMessage, setAccountMessage] = useState<string | null>(null);

  async function handleAccountSave(e: React.FormEvent) {
    e.preventDefault();
    setAccountStatus("loading");
    setAccountMessage(null);
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: displayName }),
      });
      if (res.ok) { setAccountStatus("success"); setAccountMessage("Name updated."); }
      else { const d = await res.json(); setAccountStatus("error"); setAccountMessage(d.error ?? "Failed to save."); }
    } catch { setAccountStatus("error"); setAccountMessage("Something went wrong."); }
  }

  // ── Session defaults ───────────────────────────────────────────────
  const [defaultGoalType, setDefaultGoalType] = useState<"time" | "pages" | "chapter">("time");
  const [defaultTargetValue, setDefaultTargetValue] = useState<string>("");
  const [sessionDefaultStatus, setSessionDefaultStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [sessionDefaultMessage, setSessionDefaultMessage] = useState<string | null>(null);

  async function handleSessionDefaultSave(e: React.FormEvent) {
    e.preventDefault();
    setSessionDefaultStatus("loading");
    setSessionDefaultMessage(null);
    try {
      const v = defaultTargetValue ? Number(defaultTargetValue) : null;
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultGoalType, defaultTargetValue: v }),
      });
      if (res.ok) { setSessionDefaultStatus("success"); setSessionDefaultMessage("Defaults saved."); }
      else { const d = await res.json(); setSessionDefaultStatus("error"); setSessionDefaultMessage(d.error ?? "Failed to save."); }
    } catch { setSessionDefaultStatus("error"); setSessionDefaultMessage("Something went wrong."); }
  }

  // ── Storage ────────────────────────────────────────────────────────
  const [storage, setStorage] = useState<{
    usedBytes: number; quotaBytes: number; pct: number;
    usedFormatted: string; quotaFormatted: string;
  } | null>(null);

  useEffect(() => {
    fetch("/api/user/storage")
      .then((r) => r.ok ? r.json() : null)
      .then(setStorage)
      .catch(() => {});
  }, []);

  // ── PDF cache limits (device-local, sent to SW) ────────────────────
  const [pdfCacheCount, setPdfCacheCountState] = useState(2);
  const [pdfCacheMb, setPdfCacheMbState] = useState(500);
  const [pdfCacheEnabled, setPdfCacheEnabledState] = useState(true);

  useEffect(() => {
    const c = Number(localStorage.getItem("bowlbeacon-pdf-cache-count")) || 2;
    const mb = Number(localStorage.getItem("bowlbeacon-pdf-cache-mb")) || 500;
    const en = localStorage.getItem("bowlbeacon-pdf-cache-enabled");
    setPdfCacheCountState(c);
    setPdfCacheMbState(mb);
    setPdfCacheEnabledState(en !== "false");
  }, []);

  function sendPdfLimitsToSw(count: number, mb: number) {
    navigator.serviceWorker?.ready.then((reg) => {
      reg.active?.postMessage({ type: "setPdfCacheLimits", maxCount: count, maxBytes: mb * 1024 * 1024 });
    }).catch(() => {});
  }

  function handlePdfCacheEnabled(enabled: boolean) {
    setPdfCacheEnabledState(enabled);
    localStorage.setItem("bowlbeacon-pdf-cache-enabled", String(enabled));
    navigator.serviceWorker?.ready.then((reg) => {
      reg.active?.postMessage({ type: "setPdfCacheEnabled", enabled });
    }).catch(() => {});
  }

  function handlePdfCacheCount(v: number) {
    const val = Math.max(1, Math.min(10, v));
    setPdfCacheCountState(val);
    localStorage.setItem("bowlbeacon-pdf-cache-count", String(val));
    sendPdfLimitsToSw(val, pdfCacheMb);
  }

  function handlePdfCacheMb(v: number) {
    const val = Math.max(100, Math.min(5000, v));
    setPdfCacheMbState(val);
    localStorage.setItem("bowlbeacon-pdf-cache-mb", String(val));
    sendPdfLimitsToSw(pdfCacheCount, val);
  }

  // ── Theme ──────────────────────────────────────────────────────────
  const [themeId, setThemeId] = useState<string>("default");
  const [themeSaving, setThemeSaving] = useState(false);

  // ── Custom themes ──────────────────────────────────────────────────
  const [customThemes, setCustomThemes] = useState<ReturnType<typeof getCustomThemes>>([]);
  const [newThemeName, setNewThemeName] = useState("My Theme");
  const [newThemePrimary, setNewThemePrimary] = useState("#6366f1");
  const [newThemeAccent, setNewThemeAccent] = useState("#8b5cf6");
  const [newThemeBg, setNewThemeBg] = useState("#ffffff");

  useEffect(() => { setCustomThemes(getCustomThemes()); }, []);

  async function applyTheme(id: string, custom = false) {
    setThemeId(id);
    setThemeSaving(true);
    document.documentElement.setAttribute("data-theme", id);
    localStorage.setItem("bowlbeacon-theme", id);
    if (custom) {
      const ct = getCustomThemes().find((t) => t.id === id);
      if (ct) applyThemeCssVars(ct);
    } else {
      clearThemeCssVars();
    }
    try {
      await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: id }),
      });
    } finally {
      setThemeSaving(false);
    }
  }

  function addCustomTheme() {
    const id = `custom-${Date.now()}`;
    const theme = buildCustomTheme(id, newThemeName.trim() || "Custom", newThemePrimary, newThemeAccent, newThemeBg);
    const updated = [...getCustomThemes(), theme];
    saveCustomThemes(updated);
    setCustomThemes(updated);
    applyTheme(id, true);
  }

  function deleteCustomTheme(id: string) {
    const updated = getCustomThemes().filter((t) => t.id !== id);
    saveCustomThemes(updated);
    setCustomThemes(updated);
    if (themeId === id) applyTheme("default");
  }

  // ── Focus music playlist (localStorage) ─────────────────────────
  const [playlist, setPlaylist] = useState<MusicTrack[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; title: string; url: string; duration: string | null; thumbnail: string | null }[]>([]);
  const [searching, setSearching] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const [pasteUrl, setPasteUrl] = useState("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPlaylist(loadPlaylist());
  }, []);

  async function addTrack(track: MusicTrack) {
    const next = [...playlist, track];
    setPlaylist(next);
    savePlaylist(next);
    setSearchQuery("");
    setSearchResults([]);

    // Resolve actual title in background for YouTube URLs with placeholder titles
    if (isYouTubeUrl(track.url) && (track.title.startsWith("http") || track.title.startsWith("YouTube –"))) {
      const real = await resolveYouTubeTitle(track.url);
      if (real) {
        setPlaylist((prev) => {
          const updated = prev.map((t) =>
            t.url === track.url && t.title === track.title ? { ...t, title: real } : t
          );
          savePlaylist(updated);
          return updated;
        });
      }
    }
  }

  function removeTrack(idx: number) {
    const next = playlist.filter((_, i) => i !== idx);
    setPlaylist(next);
    savePlaylist(next);
  }

  function clearPlaylist() {
    setPlaylist([]);
    savePlaylist([]);
  }

  async function doSearch(q: string) {
    if (q.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/music/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results ?? []);
      }
    } catch {} finally {
      setSearching(false);
    }
  }

  function handleSearchInput(val: string) {
    setSearchQuery(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => doSearch(val), 400);
  }

  useEffect(() => {
    fetch("/api/user/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setMinutesGoal(data.dailyMinutesGoal != null ? String(data.dailyMinutesGoal) : "");
        setSessionsGoal(data.dailySessionsGoal != null ? String(data.dailySessionsGoal) : "");
        setInactivityMin(data.inactivityTimeout != null ? String(data.inactivityTimeout) : "");
        setQuizMin(data.quizMinQuestions != null ? String(data.quizMinQuestions) : "");
        setQuizMax(data.quizMaxQuestions != null ? String(data.quizMaxQuestions) : "");
        if (data.themeId) setThemeId(data.themeId);
        if (data.name) setDisplayName(data.name);
        if (data.email) setAccountEmail(data.email);
        if (data.defaultGoalType) setDefaultGoalType(data.defaultGoalType);
        if (data.defaultTargetValue) setDefaultTargetValue(String(data.defaultTargetValue));
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
          quizMinQuestions: quizMin === "" ? 0 : Number(quizMin),
          quizMaxQuestions: quizMax === "" ? 0 : Number(quizMax),
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
      <div className="mx-auto max-w-4xl px-6 py-10">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6 [column-span:all]">
          <Link
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-black dark:hover:text-white underline underline-offset-4"
          >
            ← Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>

        <div className="md:columns-2 gap-4">

        {/* Daily goals */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900 break-inside-avoid mb-4 [column-span:all]">
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

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Quiz question count
              </label>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">
                After each session the quiz scales with pages read. Set your min and max. Leave blank for defaults (min&nbsp;3, max&nbsp;10). Max allowed:&nbsp;25.
              </p>
              <div className="flex items-center gap-3">
                <div className="relative w-28">
                  <input
                    type="number"
                    min={1}
                    max={25}
                    value={quizMin}
                    onChange={(e) => { setQuizMin(e.target.value); setGoalsStatus("idle"); }}
                    placeholder="3"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                    min
                  </span>
                </div>
                <span className="text-xs text-gray-400">to</span>
                <div className="relative w-28">
                  <input
                    type="number"
                    min={1}
                    max={25}
                    value={quizMax}
                    onChange={(e) => { setQuizMax(e.target.value); setGoalsStatus("idle"); }}
                    placeholder="10"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                    max
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
              className="btn-primary w-full rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {goalsStatus === "loading" ? "Saving…" : "Save goals"}
            </button>
          </form>
        </section>

        {/* Account details */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900 break-inside-avoid mb-4">
          <h2 className="text-base font-semibold mb-1">Account</h2>
          {displayName && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Signed in as <span className="font-semibold text-gray-900 dark:text-gray-100">{displayName}</span>
            </p>
          )}
          <form onSubmit={handleAccountSave} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Display name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setAccountStatus("idle"); }}
                maxLength={64}
                placeholder="Your name"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
              />
            </div>
            {accountMessage && (
              <p className={`text-sm ${accountStatus === "success" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>{accountMessage}</p>
            )}
            <button type="submit" disabled={accountStatus === "loading"} className="btn-primary w-full rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
              {accountStatus === "loading" ? "Saving…" : "Save name"}
            </button>
          </form>
        </section>

        {/* Session defaults */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900 break-inside-avoid mb-4">
          <h2 className="text-base font-semibold mb-1">Session defaults</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
            Pre-fill the goal type and target whenever you start a new session.
          </p>
          <form onSubmit={handleSessionDefaultSave} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Default goal type</label>
              <div className="grid grid-cols-3 gap-2">
                {(["time", "pages", "chapter"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => { setDefaultGoalType(type); setSessionDefaultStatus("idle"); }}
                    className={`rounded-lg border py-2 text-sm font-medium capitalize transition ${
                      defaultGoalType === type
                        ? "btn-primary border-accent"
                        : "border-gray-300 hover:border-gray-400 dark:border-gray-600"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
            {defaultGoalType !== undefined && (
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {defaultGoalType === "time" ? "Default duration (min)" : defaultGoalType === "chapter" ? "Default number of chapters" : "Default page count"}
                </label>
                <input
                  type="number"
                  min={1}
                  max={defaultGoalType === "time" ? 480 : defaultGoalType === "chapter" ? 50 : 500}
                  value={defaultTargetValue}
                  onChange={(e) => { setDefaultTargetValue(e.target.value); setSessionDefaultStatus("idle"); }}
                  placeholder={defaultGoalType === "time" ? "e.g. 25" : defaultGoalType === "chapter" ? "e.g. 2" : "e.g. 10"}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                />
              </div>
            )}
            {sessionDefaultMessage && (
              <p className={`text-sm ${sessionDefaultStatus === "success" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>{sessionDefaultMessage}</p>
            )}
            <button type="submit" disabled={sessionDefaultStatus === "loading"} className="btn-primary w-full rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
              {sessionDefaultStatus === "loading" ? "Saving…" : "Save defaults"}
            </button>
          </form>
        </section>

        {/* Textbook display size — paired with Offline PDF cache (similar heights) */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900 break-inside-avoid mb-4">
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
                    ? "btn-primary border-accent"
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

        {/* PDF offline cache limits */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900 break-inside-avoid mb-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-semibold">Offline PDF cache</h2>
            <button
              type="button"
              onClick={() => handlePdfCacheEnabled(!pdfCacheEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${pdfCacheEnabled ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"}`}
              aria-checked={pdfCacheEnabled}
              role="switch"
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${pdfCacheEnabled ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
            {pdfCacheEnabled
              ? "Textbooks you open are cached on this device so they load instantly and work offline. Older ones are evicted when either limit is reached."
              : "Caching is off. Textbooks will always load from the network and won't be available offline."}
          </p>
          {pdfCacheEnabled && (
          <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Max textbooks cached
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={pdfCacheCount}
                  onChange={(e) => handlePdfCacheCount(Number(e.target.value))}
                  className="w-20 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                />
                <span className="text-xs text-gray-400">books (1 – 10)</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Max cache size
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={100}
                  max={5000}
                  step={100}
                  value={pdfCacheMb}
                  onChange={(e) => handlePdfCacheMb(Number(e.target.value))}
                  className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                />
                <span className="text-xs text-gray-400">MB (100 – 5000)</span>
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
            Default: 2 textbooks or 500 MB. Saved on this device only.
          </p>
          </>
          )}
        </section>

        {/* Storage — paired with Exit password */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900 break-inside-avoid mb-4">
          <h2 className="text-base font-semibold mb-1">Upload storage</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 leading-relaxed">
            Space used by your uploaded PDFs.
          </p>
          {storage ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{storage.usedFormatted} used</span>
                <span className="text-gray-500 dark:text-gray-400">{storage.quotaFormatted} limit</span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${storage.pct >= 90 ? "bg-red-500" : storage.pct >= 70 ? "bg-amber-500" : "bg-accent"}`}
                  style={{ width: `${storage.pct}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">{storage.pct}% of your quota used</p>
              {storage.pct >= 90 && (
                <p className="text-xs text-red-500 font-medium">
                  Storage nearly full — delete unused PDFs from My Drive to free space.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500 animate-pulse">Loading…</p>
          )}
        </section>

        {/* Exit password — paired with Upload storage */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900 break-inside-avoid mb-4">
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
              className="btn-primary w-full rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {pwStatus === "loading" ? "Saving…" : "Save exit password"}
            </button>
          </form>
        </section>

        {/* About / credits + easter egg */}
        <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden dark:border-gray-700 dark:bg-gray-900 break-inside-avoid mb-4">
          {!pdfCacheEnabled && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/easter-egg-dog.png" alt="A very good boy" className="w-full object-cover" />
          )}
          <div className="p-5">
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              Bowl Beacon was a passion project designed by Jayden Wong as an introductory lession to learn how to code. He attributes his knowledge to his Mom and her friend for guiding him through this project, helping him develop key features, and helping him understand how this app—and coding/app development in general—works. If any issues or bugs are found please report them through the message developer button found at the bottom of the dashboard. Happy studying and good luck at your next competition!
            </p>
          </div>
        </section>

        {/* Focus music playlist */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900 break-inside-avoid mb-4 [column-span:all]">
          <h2 className="text-base font-semibold mb-1">Focus music</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
            Build a study playlist. Search for songs or paste a URL. Music loops
            automatically during sessions. Saved on this device.
          </p>

          {/* Search / URL toggle */}
          <div className="flex gap-1 mb-3">
            <button
              onClick={() => setUrlMode(false)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${!urlMode ? "btn-primary" : "border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
            >
              Search songs
            </button>
            <button
              onClick={() => setUrlMode(true)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${urlMode ? "btn-primary" : "border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"}`}
            >
              Paste URL
            </button>
          </div>

          {urlMode ? (
            <div className="flex gap-2 mb-3">
              <input
                type="url"
                value={pasteUrl}
                onChange={(e) => setPasteUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && pasteUrl.trim()) {
                    addTrack({ url: pasteUrl.trim(), title: pasteUrl.trim().slice(0, 60) });
                    setPasteUrl("");
                  }
                }}
                placeholder="https://youtube.com/watch?v=..."
                className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
              />
              <button
                onClick={() => {
                  if (pasteUrl.trim()) {
                    addTrack({ url: pasteUrl.trim(), title: pasteUrl.trim().slice(0, 60) });
                    setPasteUrl("");
                  }
                }}
                className="btn-primary rounded-lg px-4 py-2 text-sm font-medium"
              >
                Add
              </button>
            </div>
          ) : (
            <div className="relative mb-3">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") doSearch(searchQuery); }}
                placeholder="Search YouTube... e.g. moonlight sonata"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 pr-10"
              />
              {searching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="h-4 w-4 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin dark:border-gray-600 dark:border-t-gray-300" />
                </div>
              )}
              {searchResults.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900 max-h-64 overflow-y-auto">
                  {searchResults.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => addTrack({ url: r.url, title: r.title })}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition border-b border-gray-100 dark:border-gray-800 last:border-b-0"
                    >
                      {r.thumbnail && (
                        <img src={r.thumbnail} alt="" className="w-12 h-9 rounded object-cover flex-shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{r.title}</p>
                        {r.duration && <p className="text-xs text-gray-500">{r.duration}</p>}
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">+ Add</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Quick search tags */}
          <div className="flex gap-2 flex-wrap mb-4">
            {["lofi hip hop", "study music", "rain sounds", "classical piano", "white noise"].map((q) => (
              <button
                key={q}
                onClick={() => { setUrlMode(false); setSearchQuery(q); doSearch(q); }}
                className="rounded-full border border-gray-300 px-3 py-1 text-xs hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800 transition"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Playlist */}
          {playlist.length > 0 && (
            <div className="space-y-1.5 mb-3">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                Playlist ({playlist.length} song{playlist.length !== 1 ? "s" : ""})
              </p>
              {playlist.map((t, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/50">
                  <span className="text-xs text-gray-400 w-5 text-right flex-shrink-0">{i + 1}</span>
                  <p className="text-sm truncate flex-1 min-w-0">{t.title}</p>
                  <button
                    onClick={() => removeTrack(i)}
                    className="text-red-400 hover:text-red-600 transition flex-shrink-0"
                    title="Remove"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
              <button onClick={clearPlaylist} className="text-xs text-red-500 hover:underline mt-1">
                Clear playlist
              </button>
            </div>
          )}

          {playlist.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">
              No songs yet. Search above to add music to your study playlist.
            </p>
          )}
        </section>

        {/* Custom theme */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900 break-inside-avoid mb-4 [column-span:all]">
          <h2 className="text-base font-semibold mb-1">Theme</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
            Pick a built-in theme or create your own with a color picker.
          </p>

          {/* Built-in themes */}
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mb-6">
            {THEMES.map((t) => {
              const isActive = themeId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => applyTheme(t.id, false)}
                  disabled={themeSaving}
                  className={`rounded-lg border py-2.5 text-xs font-medium transition ${
                    isActive
                      ? "border-accent ring-2 ring-accent/20"
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

          {/* Custom themes */}
          {customThemes.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Your themes</p>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                {customThemes.map((t) => {
                  const isActive = themeId === t.id;
                  return (
                    <div key={t.id} className="relative group">
                      <button
                        onClick={() => applyTheme(t.id, true)}
                        disabled={themeSaving}
                        className={`w-full rounded-lg border py-2.5 text-xs font-medium transition ${
                          isActive
                            ? "border-accent ring-2 ring-accent/20"
                            : "border-gray-300 hover:border-gray-400 dark:border-gray-600"
                        }`}
                      >
                        <div className="flex justify-center gap-1 mb-1.5">
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.primary }} />
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.accent }} />
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.bg, border: "1px solid #d1d5db" }} />
                        </div>
                        <span className="block truncate px-1">{t.name}</span>
                      </button>
                      <button
                        onClick={() => deleteCustomTheme(t.id)}
                        className="absolute -top-1.5 -right-1.5 hidden group-hover:flex w-4 h-4 rounded-full bg-red-500 text-white text-[9px] items-center justify-center leading-none"
                        title="Delete theme"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Create custom theme */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-3">Create custom theme</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Name</label>
                <input
                  type="text"
                  value={newThemeName}
                  onChange={(e) => setNewThemeName(e.target.value)}
                  maxLength={20}
                  placeholder="My Theme"
                  className="w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Primary</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newThemePrimary}
                    onChange={(e) => setNewThemePrimary(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded-lg border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800"
                  />
                  <span className="text-xs text-gray-400 font-mono">{newThemePrimary}</span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Accent</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newThemeAccent}
                    onChange={(e) => setNewThemeAccent(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded-lg border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800"
                  />
                  <span className="text-xs text-gray-400 font-mono">{newThemeAccent}</span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Background</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newThemeBg}
                    onChange={(e) => setNewThemeBg(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded-lg border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800"
                  />
                  <span className="text-xs text-gray-400 font-mono">{newThemeBg}</span>
                </div>
              </div>
            </div>
            {/* Preview */}
            <div
              className="rounded-lg p-3 mb-3 flex items-center gap-3 text-sm border"
              style={{ backgroundColor: newThemeBg, borderColor: newThemePrimary + "40" }}
            >
              <span
                className="rounded-md px-3 py-1 text-xs font-medium"
                style={{ backgroundColor: newThemePrimary, color: "#ffffff" }}
              >
                Button
              </span>
              <span style={{ color: newThemeAccent }} className="text-xs font-medium">Accent text</span>
              <span className="text-xs text-gray-500">Preview</span>
            </div>
            <button
              onClick={addCustomTheme}
              className="btn-primary rounded-lg px-4 py-2 text-sm font-medium"
            >
              Save &amp; apply theme
            </button>
          </div>
        </section>

        {/* Keyboard shortcuts reference */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900 break-inside-avoid mb-4 [column-span:all]">
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
        </div>{/* end grid */}
      </div>
    </main>
  );
}
