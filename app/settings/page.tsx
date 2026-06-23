"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { getPdfZoom, setPdfZoom } from "@/lib/prefs";
import { THEMES, getThemeById, getCustomThemes, saveCustomThemes, buildCustomTheme, applyThemeCssVars, clearThemeCssVars } from "@/lib/themes";
import { loadPlaylist, savePlaylist, resolveYouTubeTitle, isYouTubeUrl, type MusicTrack } from "@/lib/music";
import { LAYOUTS, resolveLayoutStateKey } from "@/lib/types/settings-layout";
import { SuiText, useUiCopy } from "@/components/ui-copy/UiCopyProvider";
import { SuiImage } from "@/components/ui-copy/SuiImage";
import { NumberField } from "@/components/forms/NumberField";
import { validatePositiveInt } from "@/lib/forms/numberField";
import { ScrollReveal } from "@/components/ScrollReveal";

const ZOOM_PRESETS = [
  { label: "Small", value: 0.75 },
  { label: "Normal", value: 1 },
  { label: "Large", value: 1.25 },
  { label: "Extra Large", value: 1.5 },
];

function EasterEggDog() {
  const { getText } = useUiCopy();
  return (
    <SuiImage
      page="settings"
      k="dog-photo"
      defSrc="/easter-egg-dog.png"
      alt={getText("settings", "dog-photo.alt", "A very good boy")}
      className="w-full object-cover rounded-2xl block"
    />
  );
}

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

  // ── Sign out ────────────────────────────────────────────────────────
  /** Disables the Log Out button while NextAuth tears down the session. */
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // `callbackUrl: "/"` sends the user to the marketing landing
      // after the session cookie clears. NextAuth performs the
      // redirect itself.
      await signOut({ callbackUrl: "/" });
    } catch {
      // signOut() rarely fails, but if it does (e.g. offline) we don't
      // want to leave the button stuck in the disabled state.
      setSigningOut(false);
    }
  }

  // ── Daily goals ─────────────────────────────────────────────────────
  const [minutesGoal, setMinutesGoal] = useState<string>("");
  const [sessionsGoal, setSessionsGoal] = useState<string>("");
  const [inactivityMin, setInactivityMin] = useState<string>("");
  const [quizMin, setQuizMin] = useState<string>("");
  const [quizMax, setQuizMax] = useState<string>("");
  // ── Spaced repetition (FSRS pacing caps) ────────────────────────────
  // Per the SRS plan, both fields are kept as strings so the input can
  // genuinely be cleared; submit-time validation enforces the integer
  // bounds (`0–500` and `1–9999`).
  const [srsNewPerDay, setSrsNewPerDay] = useState<string>("");
  const [srsReviewsPerDay, setSrsReviewsPerDay] = useState<string>("");
  const [srsStatus, setSrsStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [srsMessage, setSrsMessage] = useState<string | null>(null);
  const [srsErrors, setSrsErrors] = useState<{ newPerDay?: string; reviewsPerDay?: string }>({});
  const [goalsStatus, setGoalsStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [goalsMessage, setGoalsMessage] = useState<string | null>(null);
  /**
   * Per-field validation errors for the daily-goals form. Empty fields
   * block submit; the error label appears under the failing input.
   */
  const [goalsErrors, setGoalsErrors] = useState<{
    minutesGoal?: string;
    sessionsGoal?: string;
    inactivityMin?: string;
    quizMin?: string;
    quizMax?: string;
  }>({});

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
  const [sessionDefaultError, setSessionDefaultError] = useState<string | null>(null);

  // ── Pomodoro ───────────────────────────────────────────────────────
  const [pomodoroEnabled, setPomodoroEnabled] = useState(false);
  const [pomodoroFocus, setPomodoroFocus] = useState("25");
  const [pomodoroBreak, setPomodoroBreak] = useState("5");
  const [pomodoroLong, setPomodoroLong] = useState("15");
  const [pomodoroCycles, setPomodoroCycles] = useState("4");
  const [pomodoroStatus, setPomodoroStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [pomodoroMessage, setPomodoroMessage] = useState<string | null>(null);
  const [pomodoroErrors, setPomodoroErrors] = useState<{
    focus?: string;
    short?: string;
    long?: string;
    cycles?: string;
  }>({});

  async function handlePomodoroSave(e: React.FormEvent) {
    e.preventDefault();
    setPomodoroMessage(null);

    // Validate every numeric field; surface the first failure under the
    // matching input. We never silently coerce empty → 0; the user must
    // either fill in a valid value or turn Pomodoro off entirely.
    const focusCheck = validatePositiveInt(pomodoroFocus, { label: "Focus minutes", min: 1, max: 90, unit: "min" });
    const breakCheck = validatePositiveInt(pomodoroBreak, { label: "Short break", min: 1, max: 30, unit: "min" });
    const longCheck = validatePositiveInt(pomodoroLong, { label: "Long break", min: 1, max: 60, unit: "min" });
    const cyclesCheck = validatePositiveInt(pomodoroCycles, { label: "Cycles", min: 1, max: 10 });
    const nextErrors: typeof pomodoroErrors = {};
    if (!focusCheck.ok) nextErrors.focus = focusCheck.error;
    if (!breakCheck.ok) nextErrors.short = breakCheck.error;
    if (!longCheck.ok) nextErrors.long = longCheck.error;
    if (!cyclesCheck.ok) nextErrors.cycles = cyclesCheck.error;
    setPomodoroErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setPomodoroStatus("error");
      return;
    }

    setPomodoroStatus("loading");
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pomodoroEnabled,
          pomodoroFocusMin: focusCheck.ok ? focusCheck.value : null,
          pomodoroBreakMin: breakCheck.ok ? breakCheck.value : null,
          pomodoroLongBreakMin: longCheck.ok ? longCheck.value : null,
          pomodoroCycles: cyclesCheck.ok ? cyclesCheck.value : null,
        }),
      });
      if (res.ok) {
        setPomodoroStatus("success");
        setPomodoroMessage("Saved.");
      } else {
        setPomodoroStatus("error");
        setPomodoroMessage("Failed to save.");
      }
    } catch {
      setPomodoroStatus("error");
      setPomodoroMessage("Network error.");
    }
  }

  async function handleSessionDefaultSave(e: React.FormEvent) {
    e.preventDefault();
    setSessionDefaultMessage(null);

    const max =
      defaultGoalType === "time" ? 480 : defaultGoalType === "chapter" ? 50 : 500;
    const label =
      defaultGoalType === "time"
        ? "Default duration"
        : defaultGoalType === "chapter"
          ? "Default chapter count"
          : "Default page count";
    const unit = defaultGoalType === "time" ? "min" : undefined;
    const check = validatePositiveInt(defaultTargetValue, { label, min: 1, max, unit });
    if (!check.ok) {
      setSessionDefaultError(check.error);
      setSessionDefaultStatus("error");
      return;
    }
    setSessionDefaultError(null);

    setSessionDefaultStatus("loading");
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultGoalType, defaultTargetValue: check.value }),
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
    void navigator.serviceWorker?.ready.then(async (reg) => {
      reg.active?.postMessage({ type: "setPdfCacheEnabled", enabled });
      if (!enabled) {
        const { clearAllPdfCachesClient } = await import("@/lib/client/pdf-cache-prefs");
        await clearAllPdfCachesClient();
      }
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
        setSrsNewPerDay(data.srsNewPerDay != null ? String(data.srsNewPerDay) : "");
        setSrsReviewsPerDay(data.srsReviewsPerDay != null ? String(data.srsReviewsPerDay) : "");
        if (data.themeId) setThemeId(data.themeId);
        if (data.name) setDisplayName(data.name);
        if (data.email) setAccountEmail(data.email);
        if (data.defaultGoalType) setDefaultGoalType(data.defaultGoalType);
        if (data.defaultTargetValue) setDefaultTargetValue(String(data.defaultTargetValue));
        if (data.pomodoroEnabled !== undefined) setPomodoroEnabled(!!data.pomodoroEnabled);
        if (data.pomodoroFocusMin) setPomodoroFocus(String(data.pomodoroFocusMin));
        if (data.pomodoroBreakMin) setPomodoroBreak(String(data.pomodoroBreakMin));
        if (data.pomodoroLongBreakMin) setPomodoroLong(String(data.pomodoroLongBreakMin));
        if (data.pomodoroCycles) setPomodoroCycles(String(data.pomodoroCycles));
        if (typeof data.exitBossBeaconsEnabled === "boolean") {
          setExitBossBeaconsEnabled(data.exitBossBeaconsEnabled);
        }
      });
  }, []);

  async function handleGoalsSave(e: React.FormEvent) {
    e.preventDefault();
    setGoalsMessage(null);

    // Validate every field on submit. Empty inputs surface an inline error
    // under the failing field instead of being silently coerced to 0 and
    // saved as "disabled" (which surprises users — they typed nothing
    // because they were about to type something, not because they wanted
    // to turn the goal off).
    const minCheck = validatePositiveInt(minutesGoal, { label: "Daily minutes goal", min: 1, max: 1440, unit: "min" });
    const sessCheck = validatePositiveInt(sessionsGoal, { label: "Daily sessions goal", min: 1, max: 20, unit: "sessions" });
    const inactCheck = validatePositiveInt(inactivityMin, { label: "Inactivity timeout", min: 1, max: 30, unit: "min" });
    const qMinCheck = validatePositiveInt(quizMin, { label: "Quiz minimum", min: 1, max: 25 });
    const qMaxCheck = validatePositiveInt(quizMax, { label: "Quiz maximum", min: 1, max: 25 });

    const nextErrors: typeof goalsErrors = {};
    if (!minCheck.ok) nextErrors.minutesGoal = minCheck.error;
    if (!sessCheck.ok) nextErrors.sessionsGoal = sessCheck.error;
    if (!inactCheck.ok) nextErrors.inactivityMin = inactCheck.error;
    if (!qMinCheck.ok) nextErrors.quizMin = qMinCheck.error;
    if (!qMaxCheck.ok) nextErrors.quizMax = qMaxCheck.error;

    // Cross-field check only when both bounds parsed cleanly.
    if (qMinCheck.ok && qMaxCheck.ok && qMinCheck.value != null && qMaxCheck.value != null && qMinCheck.value > qMaxCheck.value) {
      nextErrors.quizMax = "Quiz max must be ≥ quiz min";
    }

    setGoalsErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setGoalsStatus("error");
      return;
    }

    // After the guard above, every check is `{ ok: true }`. Re-narrow
    // by re-running the validators (cheap) so TypeScript can see `.value`.
    if (!minCheck.ok || !sessCheck.ok || !inactCheck.ok || !qMinCheck.ok || !qMaxCheck.ok) return;

    setGoalsStatus("loading");
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyMinutesGoal: minCheck.value,
          dailySessionsGoal: sessCheck.value,
          inactivityTimeout: inactCheck.value,
          quizMinQuestions: qMinCheck.value,
          quizMaxQuestions: qMaxCheck.value,
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

  // ── Spaced repetition save handler ──────────────────────────────────
  // Saves the per-user FSRS pacing caps. `srsNewPerDay` allows 0
  // (means "pause new card introduction"), so we set min=0; min stays
  // at 1 for `srsReviewsPerDay` because "review at most 0 cards/day"
  // would just lock the user out of the feature without warning.
  async function handleSrsSave(e: React.FormEvent) {
    e.preventDefault();
    setSrsMessage(null);

    const newCheck = validatePositiveInt(srsNewPerDay, { label: "New cards per day", min: 0, max: 500 });
    const reviewsCheck = validatePositiveInt(srsReviewsPerDay, { label: "Max reviews per day", min: 1, max: 9999 });

    const nextErrors: typeof srsErrors = {};
    if (!newCheck.ok) nextErrors.newPerDay = newCheck.error;
    if (!reviewsCheck.ok) nextErrors.reviewsPerDay = reviewsCheck.error;

    setSrsErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSrsStatus("error");
      return;
    }

    if (!newCheck.ok || !reviewsCheck.ok) return;

    setSrsStatus("loading");
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          srsNewPerDay: newCheck.value,
          srsReviewsPerDay: reviewsCheck.value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSrsStatus("success");
        setSrsMessage("Review settings saved.");
      } else {
        setSrsStatus("error");
        setSrsMessage(data.error ?? "Something went wrong.");
      }
    } catch {
      setSrsStatus("error");
      setSrsMessage("Network error. Please try again.");
    }
  }

  // ── Exit protection + login password ─────────────────────────────
  const [exitBossBeaconsEnabled, setExitBossBeaconsEnabled] = useState(true);
  const [exitBossStatus, setExitBossStatus] = useState<"idle" | "loading" | "error">("idle");
  const [exitBossMessage, setExitBossMessage] = useState<string | null>(null);

  const [loginCurrentPassword, setLoginCurrentPassword] = useState("");
  const [loginNewPassword, setLoginNewPassword] = useState("");
  const [loginConfirmPassword, setLoginConfirmPassword] = useState("");
  const [loginPwStatus, setLoginPwStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [loginPwMessage, setLoginPwMessage] = useState<string | null>(null);

  /** Login password form stays hidden until the user verifies their login password. */
  const [passwordFormsUnlocked, setPasswordFormsUnlocked] = useState(false);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlockLoading, setUnlockLoading] = useState(false);
  /** Shown on the locked panel for a few seconds after a successful save. */
  const [passwordSectionFlash, setPasswordSectionFlash] = useState<string | null>(null);

  function lockPasswordForms() {
    setPasswordFormsUnlocked(false);
    setLoginCurrentPassword("");
    setLoginNewPassword("");
    setLoginConfirmPassword("");
    setLoginPwMessage(null);
    setLoginPwStatus("idle");
  }

  async function handleExitBossToggle(enabled: boolean) {
    setExitBossBeaconsEnabled(enabled);
    setExitBossStatus("loading");
    setExitBossMessage(null);
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exitBossBeaconsEnabled: enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setExitBossStatus("idle");
      } else {
        setExitBossBeaconsEnabled(!enabled);
        setExitBossStatus("error");
        setExitBossMessage(data.error ?? "Could not save setting.");
      }
    } catch {
      setExitBossBeaconsEnabled(!enabled);
      setExitBossStatus("error");
      setExitBossMessage("Network error. Please try again.");
    }
  }

  useEffect(() => {
    if (!passwordSectionFlash) return;
    const t = window.setTimeout(() => setPasswordSectionFlash(null), 5000);
    return () => window.clearTimeout(t);
  }, [passwordSectionFlash]);

  async function submitUnlock(e: React.FormEvent) {
    e.preventDefault();
    setUnlockError(null);
    if (!unlockPassword.trim()) {
      setUnlockError("Enter your login password.");
      return;
    }
    setUnlockLoading(true);
    try {
      const res = await fetch("/api/user/verify-login-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: unlockPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPasswordFormsUnlocked(true);
        setShowUnlockModal(false);
        setUnlockPassword("");
        setUnlockError(null);
      } else {
        setUnlockError(typeof data.error === "string" ? data.error : "Could not verify password.");
      }
    } catch {
      setUnlockError("Network error. Try again.");
    } finally {
      setUnlockLoading(false);
    }
  }

  useEffect(() => {
    if (!showUnlockModal) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setShowUnlockModal(false);
        setUnlockPassword("");
        setUnlockError(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showUnlockModal]);

  async function handleLoginPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoginPwMessage(null);
    if (loginNewPassword !== loginConfirmPassword) {
      setLoginPwStatus("error");
      setLoginPwMessage("New passwords don't match.");
      return;
    }
    if (loginNewPassword.length < 6) {
      setLoginPwStatus("error");
      setLoginPwMessage("Login password must be at least 6 characters.");
      return;
    }
    setLoginPwStatus("loading");
    try {
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentLoginPassword: loginCurrentPassword,
          newLoginPassword: loginNewPassword,
          confirmLoginPassword: loginConfirmPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setPasswordSectionFlash("Login password updated.");
        lockPasswordForms();
      } else {
        setLoginPwStatus("error");
        setLoginPwMessage(data.error ?? "Something went wrong.");
      }
    } catch {
      setLoginPwStatus("error");
      setLoginPwMessage("Network error. Please try again.");
    }
  }

  // ── Layout state — pick one of 4 hardcoded layouts based on current toggles ─
  const activeStateKey = resolveLayoutStateKey(pdfCacheEnabled, pomodoroEnabled);
  const layoutSpec = LAYOUTS[activeStateKey];

  // ── Stubs kept for backwards-compat with the existing section JSX below ───
  // The layout is now fully hardcoded, so these helpers just return the defaults.
  function ctitle(_id: string, def: string) { return def; }
  function titleClass(_id: string, extra = "") {
    return `text-base font-semibold${extra ? " " + extra : ""}`;
  }
  function descClass(_id: string, extra = "") {
    return `text-sm text-gray-500 dark:text-gray-400 leading-relaxed${extra ? " " + extra : ""}`;
  }
  function cardStyle(_id: string): React.CSSProperties { return {}; }
  function cardGridCol(_id: string): React.CSSProperties { return {}; }

  return (
    <>
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-black dark:hover:text-white underline underline-offset-4"
          >
            ← Dashboard
          </Link>
          <h1 className="text-2xl font-bold">
            <SuiText page="settings" k="settings.page-title" def="Settings" as="span" />
          </h1>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 -mt-2 mb-6">
          Scroll down for session defaults, study breaks, PDF cache, exit protection, theme, music, and more.
        </p>

        {/* Hardcoded per-state layout: TOP full-width → 2-col LEFT+RIGHT → BOTTOM full-width */}
        <div className="space-y-4">
        {(() => {
          const CS = "rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900";
          const cardSectionMap: Record<string, React.ReactNode> = {
            "daily-goals": (
              <section key="daily-goals" style={{ ...cardGridCol("daily-goals"), ...cardStyle("daily-goals") }} className={CS}>
                <h2 className={titleClass("daily-goals", "mb-1")}>
                  <SuiText page="settings" k="daily-goals.title" def="Daily goals" as="span" />
                </h2>
                <p className={descClass("daily-goals", "mb-5")}>
                  <SuiText
                    page="settings"
                    k="daily-goals.desc"
                    def="Set targets for each day. Your progress towards these will be shown on the dashboard. Each field must be a positive number — fill them in before saving."
                    as="span"
                  />
                </p>
                <form onSubmit={handleGoalsSave} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <NumberField
                      label={<SuiText page="settings" k="daily-goals.label.minutes" def="Minutes per day" as="span" />}
                      value={minutesGoal}
                      onChange={(s) => {
                        setMinutesGoal(s);
                        setGoalsStatus("idle");
                        if (goalsErrors.minutesGoal) setGoalsErrors((p) => ({ ...p, minutesGoal: undefined }));
                      }}
                      min={1}
                      max={1440}
                      unit="min"
                      placeholder="e.g. 60"
                      error={goalsErrors.minutesGoal}
                    />
                    <NumberField
                      label={<SuiText page="settings" k="daily-goals.label.sessions" def="Sessions per day" as="span" />}
                      value={sessionsGoal}
                      onChange={(s) => {
                        setSessionsGoal(s);
                        setGoalsStatus("idle");
                        if (goalsErrors.sessionsGoal) setGoalsErrors((p) => ({ ...p, sessionsGoal: undefined }));
                      }}
                      min={1}
                      max={20}
                      unit="sessions"
                      placeholder="e.g. 2"
                      error={goalsErrors.sessionsGoal}
                    />
                  </div>
                  <NumberField
                    label={<SuiText page="settings" k="daily-goals.label.inactivity" def="Inactivity timeout" as="span" />}
                    hint={
                      <SuiText
                        page="settings"
                        k="daily-goals.hint.inactivity"
                        def="Pause timer & ask if you're still reading after this many minutes of no interaction. Default is 3 min."
                        as="span"
                      />
                    }
                    value={inactivityMin}
                    onChange={(s) => {
                      setInactivityMin(s);
                      setGoalsStatus("idle");
                      if (goalsErrors.inactivityMin) setGoalsErrors((p) => ({ ...p, inactivityMin: undefined }));
                    }}
                    min={1}
                    max={30}
                    unit="min"
                    placeholder="3"
                    error={goalsErrors.inactivityMin}
                    inputWidthClassName="w-40"
                  />
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      <SuiText page="settings" k="daily-goals.label.quiz" def="Quiz question count" as="span" />
                    </label>
                    <div className="mb-2 flex flex-wrap items-end gap-3">
                      <NumberField
                        value={quizMin}
                        onChange={(s) => {
                          setQuizMin(s);
                          setGoalsStatus("idle");
                          if (goalsErrors.quizMin) setGoalsErrors((p) => ({ ...p, quizMin: undefined }));
                        }}
                        min={1}
                        max={25}
                        unit="min"
                        placeholder="3"
                        error={goalsErrors.quizMin}
                        className="w-28 min-w-[7rem] shrink-0"
                      />
                      <span className="text-xs text-gray-400 shrink-0 pb-2.5">to</span>
                      <NumberField
                        value={quizMax}
                        onChange={(s) => {
                          setQuizMax(s);
                          setGoalsStatus("idle");
                          if (goalsErrors.quizMax) setGoalsErrors((p) => ({ ...p, quizMax: undefined }));
                        }}
                        min={1}
                        max={25}
                        unit="max"
                        placeholder="10"
                        error={goalsErrors.quizMax}
                        className="w-28 min-w-[7rem] shrink-0"
                      />
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      <SuiText
                        page="settings"
                        k="daily-goals.hint.quiz"
                        def="After each session the quiz scales with pages read. Set your min and max (must be positive; max ≤ 25)."
                        as="span"
                      />
                    </p>
                  </div>
                  {goalsMessage && (
                    <p className={`text-sm ${goalsStatus === "success" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{goalsMessage}</p>
                  )}
                  <button type="submit" disabled={goalsStatus === "loading"} className="btn-primary w-full rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50">
                    {goalsStatus === "loading" ? (
                      "Saving…"
                    ) : (
                      <SuiText page="settings" k="daily-goals.save" def="Save goals" as="span" />
                    )}
                  </button>
                </form>
              </section>
            ),

            "spaced-repetition": (
              <section key="spaced-repetition" style={{ ...cardGridCol("spaced-repetition"), ...cardStyle("spaced-repetition") }} className={CS}>
                <h2 className={titleClass("spaced-repetition", "mb-1")}>
                  <SuiText page="settings" k="spaced-repetition.title" def="Spaced repetition" as="span" />
                </h2>
                <p className={descClass("spaced-repetition", "mb-5")}>
                  <SuiText
                    page="settings"
                    k="spaced-repetition.desc"
                    def="Daily caps for the /review queue. Cards already past their schedule will surface up to these limits — extras roll over to the next day."
                    as="span"
                  />
                </p>
                <form onSubmit={handleSrsSave} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <NumberField
                      label={<SuiText page="settings" k="spaced-repetition.new-per-day" def="New cards per day" as="span" />}
                      hint={<SuiText page="settings" k="spaced-repetition.new-per-day.hint" def="0–500. 0 pauses new cards." as="span" />}
                      value={srsNewPerDay}
                      onChange={(s) => {
                        setSrsNewPerDay(s);
                        setSrsStatus("idle");
                        if (srsErrors.newPerDay) setSrsErrors((p) => ({ ...p, newPerDay: undefined }));
                      }}
                      min={0}
                      max={500}
                      placeholder="20"
                      error={srsErrors.newPerDay}
                    />
                    <NumberField
                      label={<SuiText page="settings" k="spaced-repetition.reviews-per-day" def="Max reviews per day" as="span" />}
                      hint={<SuiText page="settings" k="spaced-repetition.reviews-per-day.hint" def="1–9999. Soft ceiling for review-only days." as="span" />}
                      value={srsReviewsPerDay}
                      onChange={(s) => {
                        setSrsReviewsPerDay(s);
                        setSrsStatus("idle");
                        if (srsErrors.reviewsPerDay) setSrsErrors((p) => ({ ...p, reviewsPerDay: undefined }));
                      }}
                      min={1}
                      max={9999}
                      placeholder="200"
                      error={srsErrors.reviewsPerDay}
                    />
                  </div>
                  {srsMessage && (
                    <p className={`text-sm ${srsStatus === "success" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>{srsMessage}</p>
                  )}
                  <button type="submit" disabled={srsStatus === "loading"} className="btn-primary w-full rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
                    {srsStatus === "loading" ? (
                      "Saving…"
                    ) : (
                      <SuiText page="settings" k="spaced-repetition.save" def="Save review settings" as="span" />
                    )}
                  </button>
                </form>
              </section>
            ),

            "account": (
              <section key="account" style={{ ...cardGridCol("account"), ...cardStyle("account") }} className={CS}>
                <h2 className={titleClass("account", "mb-1")}>
                  <SuiText page="settings" k="account.title" def="Account" as="span" />
                </h2>
                {displayName && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    <SuiText page="settings" k="account.signed-prefix" def="Signed in as" as="span" />{" "}
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{displayName}</span>
                  </p>
                )}
                <form onSubmit={handleAccountSave} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      <SuiText page="settings" k="account.label.display-name" def="Display name" as="span" />
                    </label>
                    <input type="text" value={displayName} onChange={(e) => { setDisplayName(e.target.value); setAccountStatus("idle"); }} maxLength={64} placeholder="Your name" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800" />
                  </div>
                  {accountMessage && (
                    <p className={`text-sm ${accountStatus === "success" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>{accountMessage}</p>
                  )}
                  <button type="submit" disabled={accountStatus === "loading"} className="btn-primary w-full rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
                    {accountStatus === "loading" ? (
                      "Saving…"
                    ) : (
                      <SuiText page="settings" k="account.save" def="Save name" as="span" />
                    )}
                  </button>
                </form>
              </section>
            ),

            "session-defaults": (
              <section key="session-defaults" style={{ ...cardGridCol("session-defaults"), ...cardStyle("session-defaults") }} className={CS}>
                <h2 className={titleClass("session-defaults", "mb-1")}>
                  <SuiText page="settings" k="session-defaults.title" def="Session defaults" as="span" />
                </h2>
                <p className={descClass("session-defaults", "mb-4")}>
                  <SuiText
                    page="settings"
                    k="session-defaults.desc"
                    def="Pre-fill the goal type and target whenever you start a new session."
                    as="span"
                  />
                </p>
                <form onSubmit={handleSessionDefaultSave} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Default goal type</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(["time", "pages", "chapter"] as const).map((type) => (
                        <button key={type} type="button" onClick={() => { setDefaultGoalType(type); setSessionDefaultStatus("idle"); }} className={`rounded-lg border py-2 text-sm font-medium capitalize transition ${defaultGoalType === type ? "btn-primary border-accent" : "border-gray-300 hover:border-gray-400 dark:border-gray-600"}`}>{type}</button>
                      ))}
                    </div>
                  </div>
                  {defaultGoalType !== undefined && (
                    <NumberField
                      label={
                        defaultGoalType === "time"
                          ? "Default duration (min)"
                          : defaultGoalType === "chapter"
                            ? "Default number of chapters"
                            : "Default page count"
                      }
                      value={defaultTargetValue}
                      onChange={(s) => {
                        setDefaultTargetValue(s);
                        setSessionDefaultStatus("idle");
                        if (sessionDefaultError) setSessionDefaultError(null);
                      }}
                      min={1}
                      max={defaultGoalType === "time" ? 480 : defaultGoalType === "chapter" ? 50 : 500}
                      unit={defaultGoalType === "time" ? "min" : undefined}
                      placeholder={defaultGoalType === "time" ? "e.g. 25" : defaultGoalType === "chapter" ? "e.g. 2" : "e.g. 10"}
                      error={sessionDefaultError}
                    />
                  )}
                  {sessionDefaultMessage && (
                    <p className={`text-sm ${sessionDefaultStatus === "success" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>{sessionDefaultMessage}</p>
                  )}
                  <button type="submit" disabled={sessionDefaultStatus === "loading"} className="btn-primary w-full rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
                    {sessionDefaultStatus === "loading" ? (
                      "Saving…"
                    ) : (
                      <SuiText page="settings" k="session-defaults.save" def="Save defaults" as="span" />
                    )}
                  </button>
                </form>
              </section>
            ),

            "study-breaks": (
              <section key="study-breaks" style={{ ...cardGridCol("study-breaks"), ...cardStyle("study-breaks") }} className={CS}>
                <div className="flex items-center justify-between mb-1">
                  <h2 className={titleClass("study-breaks")}>
                    <SuiText page="settings" k="study-breaks.title" def="Study breaks" as="span" />
                  </h2>
                  <button type="button" onClick={() => { setPomodoroEnabled(!pomodoroEnabled); setPomodoroStatus("idle"); }} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${pomodoroEnabled ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"}`} role="switch" aria-checked={pomodoroEnabled}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${pomodoroEnabled ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>
                <p className={descClass("study-breaks", "mb-4")}>
                  <SuiText
                    page="settings"
                    k={pomodoroEnabled ? "study-breaks.desc-on" : "study-breaks.desc-off"}
                    def={
                      pomodoroEnabled
                        ? "Cycles between focus and break intervals during study sessions."
                        : "Off — sessions use a continuous timer."
                    }
                    as="span"
                  />
                </p>
                {pomodoroEnabled && (
                  <form onSubmit={handlePomodoroSave} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <NumberField
                        label="Focus (min)"
                        value={pomodoroFocus}
                        onChange={(s) => {
                          setPomodoroFocus(s);
                          setPomodoroStatus("idle");
                          if (pomodoroErrors.focus) setPomodoroErrors((p) => ({ ...p, focus: undefined }));
                        }}
                        min={1}
                        max={90}
                        placeholder="25"
                        error={pomodoroErrors.focus}
                      />
                      <NumberField
                        label="Short break (min)"
                        value={pomodoroBreak}
                        onChange={(s) => {
                          setPomodoroBreak(s);
                          setPomodoroStatus("idle");
                          if (pomodoroErrors.short) setPomodoroErrors((p) => ({ ...p, short: undefined }));
                        }}
                        min={1}
                        max={30}
                        placeholder="5"
                        error={pomodoroErrors.short}
                      />
                      <NumberField
                        label="Long break (min)"
                        value={pomodoroLong}
                        onChange={(s) => {
                          setPomodoroLong(s);
                          setPomodoroStatus("idle");
                          if (pomodoroErrors.long) setPomodoroErrors((p) => ({ ...p, long: undefined }));
                        }}
                        min={1}
                        max={60}
                        placeholder="15"
                        error={pomodoroErrors.long}
                      />
                      <NumberField
                        label="Cycles before long break"
                        value={pomodoroCycles}
                        onChange={(s) => {
                          setPomodoroCycles(s);
                          setPomodoroStatus("idle");
                          if (pomodoroErrors.cycles) setPomodoroErrors((p) => ({ ...p, cycles: undefined }));
                        }}
                        min={1}
                        max={10}
                        placeholder="4"
                        error={pomodoroErrors.cycles}
                      />
                    </div>
                    {pomodoroMessage && (
                      <p className={`text-sm ${pomodoroStatus === "success" ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>{pomodoroMessage}</p>
                    )}
                    <button type="submit" disabled={pomodoroStatus === "loading"} className="btn-primary w-full rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
                      {pomodoroStatus === "loading" ? (
                        "Saving…"
                      ) : (
                        <SuiText page="settings" k="study-breaks.save" def="Save break settings" as="span" />
                      )}
                    </button>
                  </form>
                )}
              </section>
            ),

            "textbook-size": (
              <section key="textbook-size" style={{ ...cardGridCol("textbook-size"), ...cardStyle("textbook-size") }} className={CS}>
                <h2 className={titleClass("textbook-size", "mb-1")}>
                  <SuiText page="settings" k="textbook-size.title" def="Textbook display size" as="span" />
                </h2>
                <p className={descClass("textbook-size", "mb-5")}>
                  <SuiText
                    page="settings"
                    k="textbook-size.desc"
                    def="Controls how large the PDF pages appear while reading. Saved on this device."
                    as="span"
                  />
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {ZOOM_PRESETS.map((preset) => {
                    const zoomKeys = ["textbook-zoom-small", "textbook-zoom-normal", "textbook-zoom-large", "textbook-zoom-xl"] as const;
                    const idx = ZOOM_PRESETS.findIndex((p) => p.value === preset.value);
                    const zk = zoomKeys[idx] ?? "textbook-zoom-normal";
                    return (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => handleZoomChange(preset.value)}
                        className={`rounded-lg border py-3 text-sm font-medium transition ${zoom === preset.value ? "btn-primary border-accent" : "border-gray-300 hover:border-gray-400 dark:border-gray-600"}`}
                      >
                        <SuiText page="settings" k={zk} def={preset.label} as="span" />
                        <span className="block text-xs opacity-60 mt-0.5">{Math.round(preset.value * 100)}%</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ),

            "pdf-cache": (
              <section key="pdf-cache" style={{ ...cardGridCol("pdf-cache"), ...cardStyle("pdf-cache") }} className={CS}>
                <div className="flex items-center justify-between mb-1">
                  <h2 className={titleClass("pdf-cache")}>
                    <SuiText page="settings" k="pdf-cache.title" def="Offline PDF cache" as="span" />
                  </h2>
                  <button type="button" onClick={() => handlePdfCacheEnabled(!pdfCacheEnabled)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${pdfCacheEnabled ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"}`} aria-checked={pdfCacheEnabled} role="switch">
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${pdfCacheEnabled ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                </div>
                <p className={descClass("pdf-cache", "mb-5")}>
                  <SuiText
                    page="settings"
                    k={pdfCacheEnabled ? "pdf-cache.desc-on" : "pdf-cache.desc-off"}
                    def={
                      pdfCacheEnabled
                        ? "Textbooks you open are cached on this device so they load instantly and work offline. Older ones are evicted when either limit is reached."
                        : "Caching is off. Textbooks will always load from the network and won't be available offline."
                    }
                    as="span"
                  />
                </p>
                {pdfCacheEnabled && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Max textbooks cached</label>
                        <div className="flex items-center gap-2">
                          <input type="number" min={1} max={10} value={pdfCacheCount} onChange={(e) => handlePdfCacheCount(Number(e.target.value))} className="w-20 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800" />
                          <span className="text-xs text-gray-400">books (1 – 10)</span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Max cache size</label>
                        <div className="flex items-center gap-2">
                          <input type="number" min={100} max={5000} step={100} value={pdfCacheMb} onChange={(e) => handlePdfCacheMb(Number(e.target.value))} className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800" />
                          <span className="text-xs text-gray-400">MB (100 – 5000)</span>
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">Default: 2 textbooks or 500 MB. Saved on this device only.</p>
                  </>
                )}
              </section>
            ),

            "upload-storage": (
              <section key="upload-storage" style={{ ...cardGridCol("upload-storage"), ...cardStyle("upload-storage") }} className={CS}>
                <h2 className={titleClass("upload-storage", "mb-1")}>
                  <SuiText page="settings" k="upload-storage.title" def="Upload storage" as="span" />
                </h2>
                <p className={descClass("upload-storage", "mb-4")}>
                  <SuiText page="settings" k="upload-storage.desc" def="Space used by your uploaded PDFs." as="span" />
                </p>
                {storage ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{storage.usedFormatted} used</span>
                      <span className="text-gray-500 dark:text-gray-400">{storage.quotaFormatted} limit</span>
                    </div>
                    <div className="w-full h-2.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${storage.pct >= 90 ? "bg-red-500" : storage.pct >= 70 ? "bg-amber-500" : "bg-accent"}`} style={{ width: `${storage.pct}%` }} />
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{storage.pct}% of your quota used</p>
                    {storage.pct >= 90 && <p className="text-xs text-red-500 font-medium">Storage nearly full — delete unused PDFs from My Drive to free space.</p>}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500 animate-pulse">Loading…</p>
                )}
              </section>
            ),

            "exit-password": (
              <section key="exit-password" style={{ ...cardGridCol("exit-password"), ...cardStyle("exit-password") }} className={CS}>
                <h2 className={titleClass("exit-password", "mb-1")}>
                  <SuiText page="settings" k="exit-password.title" def="Exit protection" as="span" />
                </h2>
                <p className={descClass("exit-password", "mb-4")}>
                  <SuiText
                    page="settings"
                    k="exit-password.desc"
                    def="When enabled, ending a session early runs Boss Beacons — a short cooldown, distraction-boss fights from pages you read, then a typed phrase if needed. Completing your timer or chapter goal still ends without a fight."
                    as="span"
                  />
                </p>

                <label className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50/80 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50 mb-5">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Boss Beacons when ending a session
                  </span>
                  <input
                    type="checkbox"
                    checked={exitBossBeaconsEnabled}
                    disabled={exitBossStatus === "loading"}
                    onChange={(e) => handleExitBossToggle(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                </label>
                {exitBossMessage && (
                  <p className="text-sm text-red-600 dark:text-red-400 mb-4">{exitBossMessage}</p>
                )}

                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Login password</h3>
                  {passwordFormsUnlocked && (
                    <button
                      type="button"
                      onClick={() => {
                        setPasswordSectionFlash(null);
                        lockPasswordForms();
                      }}
                      className="shrink-0 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                      title="Hide password fields until you unlock again"
                    >
                      Lock
                    </button>
                  )}
                </div>

                {!passwordFormsUnlocked ? (
                  <>
                    {passwordSectionFlash && (
                      <p className="mb-3 text-sm font-medium text-green-600 dark:text-green-400">{passwordSectionFlash}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setShowUnlockModal(true);
                        setUnlockError(null);
                      }}
                      className="mt-2 w-full rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-6 text-center transition hover:border-gray-400 hover:bg-gray-100/80 dark:border-gray-600 dark:bg-gray-900/40 dark:hover:border-gray-500 dark:hover:bg-gray-800/50"
                    >
                      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Login password is locked</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Click here and enter your login password to change it.
                      </p>
                    </button>
                  </>
                ) : (
                  <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-gray-800/50">
                    <form onSubmit={handleLoginPasswordSubmit} className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Current password</label>
                        <input
                          type="password"
                          value={loginCurrentPassword}
                          onChange={(e) => setLoginCurrentPassword(e.target.value)}
                          required
                          autoComplete="current-password"
                          placeholder="Your current login password"
                          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">New password</label>
                        <input
                          type="password"
                          value={loginNewPassword}
                          onChange={(e) => setLoginNewPassword(e.target.value)}
                          required
                          autoComplete="new-password"
                          placeholder="At least 6 characters"
                          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Confirm new password</label>
                        <input
                          type="password"
                          value={loginConfirmPassword}
                          onChange={(e) => setLoginConfirmPassword(e.target.value)}
                          required
                          autoComplete="new-password"
                          placeholder="Repeat new password"
                          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                        />
                      </div>
                      {loginPwMessage && (
                        <p className={`text-sm ${loginPwStatus === "success" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                          {loginPwMessage}
                        </p>
                      )}
                      <button
                        type="submit"
                        disabled={loginPwStatus === "loading"}
                        className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700/50 disabled:opacity-50"
                      >
                        {loginPwStatus === "loading" ? "Updating…" : "Update login password"}
                      </button>
                    </form>
                  </div>
                )}

                {showUnlockModal && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="unlock-password-title"
                      className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900"
                    >
                      <h3 id="unlock-password-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
                        Unlock password settings
                      </h3>
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Enter your login password to show the forms.
                      </p>
                      <form onSubmit={submitUnlock} className="mt-4 space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Login password</label>
                          <input
                            type="password"
                            value={unlockPassword}
                            onChange={(e) => setUnlockPassword(e.target.value)}
                            autoComplete="current-password"
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                            placeholder="Your login password"
                            autoFocus
                          />
                        </div>
                        {unlockError && <p className="text-sm text-red-600 dark:text-red-400">{unlockError}</p>}
                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setShowUnlockModal(false);
                              setUnlockPassword("");
                              setUnlockError(null);
                            }}
                            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={unlockLoading}
                            className="btn-primary flex-1 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                          >
                            {unlockLoading ? "Checking…" : "Unlock"}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </section>
            ),

            "focus-music": (
              <section key="focus-music" style={{ ...cardGridCol("focus-music"), ...cardStyle("focus-music") }} className={CS}>
                <h2 className={titleClass("focus-music", "mb-1")}>
                  <SuiText page="settings" k="focus-music.title" def="Focus music" as="span" />
                </h2>
                <p className={descClass("focus-music", "mb-5")}>
                  <SuiText
                    page="settings"
                    k="focus-music.desc"
                    def="Build a study playlist. Search for songs or paste a URL. Music loops automatically during sessions. Saved on this device."
                    as="span"
                  />
                </p>
                <div className="flex gap-1 mb-3">
                  <button onClick={() => setUrlMode(false)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${!urlMode ? "btn-primary" : "border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"}`}>Search songs</button>
                  <button onClick={() => setUrlMode(true)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${urlMode ? "btn-primary" : "border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"}`}>Paste URL</button>
                </div>
                {urlMode ? (
                  <div className="flex gap-2 mb-3">
                    <input type="url" value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && pasteUrl.trim()) { addTrack({ url: pasteUrl.trim(), title: pasteUrl.trim().slice(0, 60) }); setPasteUrl(""); } }} placeholder="https://youtube.com/watch?v=..." className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800" />
                    <button onClick={() => { if (pasteUrl.trim()) { addTrack({ url: pasteUrl.trim(), title: pasteUrl.trim().slice(0, 60) }); setPasteUrl(""); } }} className="btn-primary rounded-lg px-4 py-2 text-sm font-medium">Add</button>
                  </div>
                ) : (
                  <div className="relative mb-3">
                    <input type="text" value={searchQuery} onChange={(e) => handleSearchInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doSearch(searchQuery); }} placeholder="Search YouTube... e.g. moonlight sonata" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 pr-10" />
                    {searching && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="h-4 w-4 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin dark:border-gray-600 dark:border-t-gray-300" />
                      </div>
                    )}
                    {searchResults.length > 0 && (
                      <div className="absolute z-20 left-0 right-0 mt-1 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900 max-h-64 overflow-y-auto">
                        {searchResults.map((r) => (
                          <button key={r.id} onClick={() => addTrack({ url: r.url, title: r.title })} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                            {r.thumbnail && <img src={r.thumbnail} alt="" className="w-12 h-9 rounded object-cover flex-shrink-0" />}
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
                <div className="flex gap-2 flex-wrap mb-4">
                  {["lofi hip hop", "study music", "rain sounds", "classical piano", "white noise"].map((q) => (
                    <button key={q} onClick={() => { setUrlMode(false); setSearchQuery(q); doSearch(q); }} className="rounded-full border border-gray-300 px-3 py-1 text-xs hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800 transition">{q}</button>
                  ))}
                </div>
                {playlist.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Playlist ({playlist.length} song{playlist.length !== 1 ? "s" : ""})</p>
                    {playlist.map((t, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/50">
                        <span className="text-xs text-gray-400 w-5 text-right flex-shrink-0">{i + 1}</span>
                        <p className="text-sm truncate flex-1 min-w-0">{t.title}</p>
                        <button onClick={() => removeTrack(i)} className="text-red-400 hover:text-red-600 transition flex-shrink-0" title="Remove">
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>
                    ))}
                    <button onClick={clearPlaylist} className="text-xs text-red-500 hover:underline mt-1">Clear playlist</button>
                  </div>
                )}
                {playlist.length === 0 && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">No songs yet. Search above to add music to your study playlist.</p>
                )}
              </section>
            ),

            "theme": (
              <section key="theme" style={{ ...cardGridCol("theme"), ...cardStyle("theme") }} className={CS}>
                <h2 className={titleClass("theme", "mb-1")}>
                  <SuiText page="settings" k="theme.title" def="Theme" as="span" />
                </h2>
                <p className={descClass("theme", "mb-5")}>
                  <SuiText page="settings" k="theme.desc" def="Pick a built-in theme or create your own with a color picker." as="span" />
                </p>
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mb-6">
                  {THEMES.map((t) => {
                    const isActive = themeId === t.id;
                    return (
                      <button key={t.id} onClick={() => applyTheme(t.id, false)} disabled={themeSaving} className={`rounded-lg border py-2.5 text-xs font-medium transition ${isActive ? "border-accent ring-2 ring-accent/20" : "border-gray-300 hover:border-gray-400 dark:border-gray-600"}`}>
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
                {customThemes.length > 0 && (
                  <div className="mb-5">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Your themes</p>
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                      {customThemes.map((t) => {
                        const isActive = themeId === t.id;
                        return (
                          <div key={t.id} className="relative group">
                            <button onClick={() => applyTheme(t.id, true)} disabled={themeSaving} className={`w-full rounded-lg border py-2.5 text-xs font-medium transition ${isActive ? "border-accent ring-2 ring-accent/20" : "border-gray-300 hover:border-gray-400 dark:border-gray-600"}`}>
                              <div className="flex justify-center gap-1 mb-1.5">
                                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.primary }} />
                                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.accent }} />
                                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.bg, border: "1px solid #d1d5db" }} />
                              </div>
                              <span className="block truncate px-1">{t.name}</span>
                            </button>
                            <button onClick={() => deleteCustomTheme(t.id)} className="absolute -top-1.5 -right-1.5 hidden group-hover:flex w-4 h-4 rounded-full bg-red-500 text-white text-[9px] items-center justify-center leading-none" title="Delete theme">×</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-3">Create custom theme</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Name</label>
                      <input type="text" value={newThemeName} onChange={(e) => setNewThemeName(e.target.value)} maxLength={20} placeholder="My Theme" className="w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Primary</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={newThemePrimary} onChange={(e) => setNewThemePrimary(e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800" />
                        <span className="text-xs text-gray-400 font-mono">{newThemePrimary}</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Accent</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={newThemeAccent} onChange={(e) => setNewThemeAccent(e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800" />
                        <span className="text-xs text-gray-400 font-mono">{newThemeAccent}</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Background</label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={newThemeBg} onChange={(e) => setNewThemeBg(e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800" />
                        <span className="text-xs text-gray-400 font-mono">{newThemeBg}</span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg p-3 mb-3 flex items-center gap-3 text-sm border" style={{ backgroundColor: newThemeBg, borderColor: newThemePrimary + "40" }}>
                    <span className="rounded-md px-3 py-1 text-xs font-medium" style={{ backgroundColor: newThemePrimary, color: "#ffffff" }}>Button</span>
                    <span style={{ color: newThemeAccent }} className="text-xs font-medium">Accent text</span>
                    <span className="text-xs text-gray-500">Preview</span>
                  </div>
                  <button onClick={addCustomTheme} className="btn-primary rounded-lg px-4 py-2 text-sm font-medium">Save &amp; apply theme</button>
                </div>
              </section>
            ),

            "keyboard-shortcuts": (
              <section key="keyboard-shortcuts" style={{ ...cardGridCol("keyboard-shortcuts"), ...cardStyle("keyboard-shortcuts") }} className={CS}>
                <h2 className={titleClass("keyboard-shortcuts", "mb-1")}>
                  <SuiText page="settings" k="keyboard-shortcuts.title" def="Keyboard shortcuts" as="span" />
                </h2>
                <p className={descClass("keyboard-shortcuts", "mb-4")}>
                  <SuiText page="settings" k="keyboard-shortcuts.desc" def="Available while reading in a study session." as="span" />
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
                      <kbd className="inline-block min-w-[3.5rem] text-center rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs font-mono dark:border-gray-600 dark:bg-gray-800">{key}</kbd>
                      <span className="text-sm text-gray-600 dark:text-gray-400">{desc}</span>
                    </div>
                  ))}
                </div>
              </section>
            ),

            "dog-photo": (
              <section key="dog-photo" className="rounded-2xl overflow-hidden">
                <EasterEggDog />
              </section>
            ),

            "logo": (
              <section key="logo" className="rounded-2xl overflow-hidden">
                <SuiImage
                  page="settings"
                  k="logo"
                  defSrc="/logo-gap-fill.png"
                  alt="Bowl Beacon"
                  className="w-full h-auto object-contain rounded-2xl block"
                />
              </section>
            ),

            "credits": (
              <section key="credits" className="rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 p-5">
                <p className={descClass("credits")}>
                  <SuiText
                    page="settings"
                    k="credits"
                    def="Bowl Beacon was a passion project designed by Jayden Wong as an introductory lesson in learning to code. He attributes his knowledge to his Mom and her friend for guiding him through this project, helping him develop key features, and helping him understand how this app—and coding/app development in general—works. If any issues or bugs are found, please report them through the message developer button found at the bottom of the dashboard. Happy studying and good luck at your next competition!"
                    as="span"
                  />
                </p>
              </section>
            ),
          };

          const renderRegion = (ids: string[]) =>
            ids.map((id) =>
              cardSectionMap[id] ? (
                <ScrollReveal key={id}>{cardSectionMap[id]}</ScrollReveal>
              ) : null
            );

          return (
            <>
              {/* TOP — full-width cards above the 2-column flow */}
              {renderRegion(layoutSpec.top)}

              {/* LEFT + RIGHT — explicit 2-column grid so the owner can place
                  specific cards in specific columns (no masonry surprises) */}
              <div className="md:grid md:grid-cols-2 md:gap-4">
                <div className="flex flex-col gap-4">{renderRegion(layoutSpec.left)}</div>
                <div className="mt-4 md:mt-0 flex flex-col gap-4">{renderRegion(layoutSpec.right)}</div>
              </div>

              {/* BOTTOM — full-width cards below the 2-column flow */}
              {renderRegion(layoutSpec.bottom)}
            </>
          );
        })()}
      </div>

        {/*
          Sign-out at the bottom of the settings page (matches the top-
          nav button on the dashboard, just placed where users
          intuitively look for an account action — bottom of settings).
          Styled as a subtle bordered button so it doesn't compete with
          the in-card primary CTAs above.
        */}
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {signingOut ? "Signing out…" : "Log out"}
          </button>
        </div>
        </div>{/* end outer container */}
    </main>
    </>
  );
}
