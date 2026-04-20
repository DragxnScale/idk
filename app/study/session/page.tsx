"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Timer, type GoalType } from "@/components/study/Timer";
import { VisibilityGuard } from "@/components/focus/VisibilityGuard";
import { OverrideFlow } from "@/components/focus/OverrideFlow";
import dynamic from "next/dynamic";
import type { SelectedDocument } from "@/components/study/DocumentPicker";
import { AiNotesPanel } from "@/components/study/AiNotesPanel";
import { loadPlaylist, savePlaylist, parseYouTubeId, isYouTubeUrl, resolveYouTubeTitle, isTitlePlaceholder, type MusicTrack } from "@/lib/music";
import { enqueueOfflineSession, updateOfflineSession, syncOfflineSessions, isOfflineId } from "@/lib/offline-session";
import { PomodoroTimer } from "@/components/study/PomodoroTimer";
import { fetchPdfCacheEntryCount } from "@/lib/client/pdf-cache-sw";
import { readPdfCacheEnabled } from "@/lib/client/pdf-cache-prefs";

const PdfViewer = dynamic(
  () => import("@/components/study/PdfViewer").then((m) => m.PdfViewer),
  { ssr: false, loading: () => <p className="text-sm text-gray-500 animate-pulse">Loading reader…</p> }
);

const DocumentPicker = dynamic(
  () => import("@/components/study/DocumentPicker").then((m) => m.DocumentPicker),
  { ssr: false, loading: () => <p className="text-sm text-gray-500 animate-pulse">Loading…</p> }
);

export default function StudySessionPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="h-8 w-8 rounded-full border-2 border-gray-300 border-t-black animate-spin dark:border-gray-600 dark:border-t-white" /></div>}>
      <StudySessionInner />
    </Suspense>
  );
}

function fmtTime(sec: number): string {
  if (!sec || !isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function StudySessionInner() {
  const searchParams = useSearchParams();
  const resumeId = searchParams.get("resume");

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [goalType, setGoalType] = useState<GoalType>("time");
  const [targetValue, setTargetValue] = useState(25);
  const [selectedChapters, setSelectedChapters] = useState<string[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [docReady, setDocReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<SelectedDocument | null>(null);
  // When a textbook with an external sourceUrl is picked, we import it to
  // public Vercel Blob once so future reads skip the proxy entirely.
  const [importingDoc, setImportingDoc] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [pageTexts, setPageTexts] = useState<Map<number, string>>(new Map());
  const [visitedPageCount, setVisitedPageCount] = useState(0);
  const [currentChapterIdx, setCurrentChapterIdx] = useState(0);
  const [jumpTarget, setJumpTarget] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [activeSession, setActiveSession] = useState<{ id: string; goalType: string; targetValue: number; totalFocusedMinutes: number } | null>(null);
  const [showAbandonConfirm, setShowAbandonConfirm] = useState(false);
  const [checkingActive, setCheckingActive] = useState(true);
  const [inactivityPrompt, setInactivityPrompt] = useState(false);
  const [inactivityTimeout, setInactivityTimeout] = useState(3); // default 3 min
  const [pomodoroEnabled, setPomodoroEnabled] = useState(false);
  const [pomodoroFocus, setPomodoroFocus] = useState(25);
  const [pomodoroBreak, setPomodoroBreak] = useState(5);
  const [pomodoroLongBreak, setPomodoroLongBreak] = useState(15);
  const [pomodoroBreakActive, setPomodoroBreakActive] = useState(false);
  const [pomodoroCyclesBeforeLong, setPomodoroCyclesBeforeLong] = useState(4);
  const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
  const [musicIdx, setMusicIdx] = useState(0);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicReady, setMusicReady] = useState(false);
  const [musicTime, setMusicTime] = useState(0);
  const [musicDuration, setMusicDuration] = useState(0);
  const ytIframeRef = useRef<HTMLIFrameElement>(null);
  const musicTimeRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytKickedRef = useRef(false);

  const focusedMinutesRef = useRef(0);
  const lastSavedRef = useRef(0);
  const accumulatedTextRef = useRef("");
  const visitedPagesRef = useRef<Set<number>>(new Set());
  const sessionEndingRef = useRef(false);
  const resumeHandled = useRef(false);
  const lastActivityRef = useRef(Date.now());
  const [pdfCacheEntryCount, setPdfCacheEntryCount] = useState<number | null>(null);
  const [pdfCacheOn, setPdfCacheOn] = useState(() =>
    typeof window !== "undefined" ? readPdfCacheEnabled() : true
  );

  // Offline PDF cache: distinct PDF count from SW (setup screen). When caching is off, count stays 0.
  useEffect(() => {
    let cancelled = false;
    function tick() {
      const on = readPdfCacheEnabled();
      setPdfCacheOn(on);
      if (!on) {
        setPdfCacheEntryCount(0);
        return;
      }
      fetchPdfCacheEntryCount().then((n) => {
        if (!cancelled) setPdfCacheEntryCount(n);
      });
    }
    tick();
    const id = window.setInterval(tick, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Online / offline awareness
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = async () => {
      setIsOnline(true);
      const synced = await syncOfflineSessions();
      if (synced > 0) {
        window.dispatchEvent(new Event("offlineSessionsSynced"));
      }
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    syncOfflineSessions().catch(() => {});
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Load user's session defaults and pre-fill goal type + target value
  useEffect(() => {
    fetch("/api/user/settings")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        if (data.defaultGoalType) setGoalType(data.defaultGoalType as GoalType);
        if (data.defaultTargetValue) setTargetValue(data.defaultTargetValue);
        if (data.pomodoroEnabled) setPomodoroEnabled(true);
        if (data.pomodoroFocusMin) setPomodoroFocus(data.pomodoroFocusMin);
        if (data.pomodoroBreakMin) setPomodoroBreak(data.pomodoroBreakMin);
        if (data.pomodoroLongBreakMin) setPomodoroLongBreak(data.pomodoroLongBreakMin);
        if (data.pomodoroCycles) setPomodoroCyclesBeforeLong(data.pomodoroCycles);
      })
      .catch(() => {});
  // Only run once on mount — intentional
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check for active session / handle resume
  useEffect(() => {
    if (resumeHandled.current) return;
    resumeHandled.current = true;

    fetch("/api/study/stats")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.inactivityTimeout) setInactivityTimeout(data.inactivityTimeout);
        if (!data?.activeSession) { setCheckingActive(false); return; }
        const active = data.activeSession;

        if (resumeId && active.id === resumeId) {
          // Resume this session
          setSessionId(active.id);
          setGoalType(active.goalType as GoalType);
          setTargetValue(active.targetValue);
          focusedMinutesRef.current = active.totalFocusedMinutes ?? 0;
          lastSavedRef.current = active.totalFocusedMinutes ?? 0;
          if (active.documentJson) {
            try { setSelectedDoc(JSON.parse(active.documentJson)); } catch {}
          }
          try { document.documentElement.requestFullscreen?.()?.catch?.(() => {}); } catch {}
          setCheckingActive(false);
        } else {
          // There's an active session but user didn't click resume
          setActiveSession(active);
          setCheckingActive(false);
        }
      })
      .catch(() => setCheckingActive(false));
  }, [resumeId]);

  // Load music playlist from localStorage, resolve placeholder titles
  useEffect(() => {
    const tracks = loadPlaylist();
    if (tracks.length === 0) return;
    setMusicTracks(tracks);

    const needsResolve = tracks.filter(
      (t) => isYouTubeUrl(t.url) && isTitlePlaceholder(t.title)
    );
    if (needsResolve.length === 0) return;

    Promise.all(
      needsResolve.map(async (t) => {
        const real = await resolveYouTubeTitle(t.url);
        return { url: t.url, oldTitle: t.title, newTitle: real };
      })
    ).then((results) => {
      setMusicTracks((prev) => {
        let changed = false;
        const updated = prev.map((t) => {
          const match = results.find((r) => r.url === t.url && r.oldTitle === t.title && r.newTitle);
          if (match) { changed = true; return { ...t, title: match.newTitle! }; }
          return t;
        });
        if (changed) savePlaylist(updated);
        return changed ? updated : prev;
      });
    });
  }, []);

  const currentTrack = musicTracks[musicIdx] ?? null;
  const currentIsYt = currentTrack ? isYouTubeUrl(currentTrack.url) : false;

  // Send a command to the YouTube iframe via postMessage
  const ytCommand = useCallback((func: string, args: unknown[] = []) => {
    ytIframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args }),
      "*"
    );
  }, []);

  const handleTrackEnd = useCallback(() => {
    if (musicTracks.length <= 1) {
      if (currentIsYt) {
        ytCommand("seekTo", [0, true]);
        ytCommand("playVideo");
      } else if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }
    } else {
      setMusicIdx((prev) => (prev + 1) % musicTracks.length);
    }
  }, [musicTracks.length, currentIsYt, ytCommand]);

  // Stable refs so the message handler never needs to re-attach
  const handleTrackEndRef = useRef(handleTrackEnd);
  useEffect(() => { handleTrackEndRef.current = handleTrackEnd; }, [handleTrackEnd]);
  const musicDurationRef = useRef(0);

  // Listen for YouTube iframe postMessage events (state, time, duration)
  // Runs once — uses refs for callbacks so dependencies never change
  useEffect(() => {
    function handleMsg(e: MessageEvent) {
      if (typeof e.data !== "string") return;
      try {
        const data = JSON.parse(e.data);
        if (data.event === "initialDelivery" || data.event === "infoDelivery") {
          const info = data.info;
          if (info?.currentTime != null) {
            setMusicTime(info.currentTime);
            musicTimeRef.current = info.currentTime;
          }
          if (info?.duration != null && info.duration > 0) {
            setMusicDuration(info.duration);
            musicDurationRef.current = info.duration;
          }
          if (info?.playerState === 0) handleTrackEndRef.current();
          if (info?.playerState === 1) setMusicPlaying(true);
        }
        if (data.event === "onReady") {
          setMusicReady(true);
        }
      } catch {}
    }
    window.addEventListener("message", handleMsg);
    return () => window.removeEventListener("message", handleMsg);
  }, []);

  // Fallback: detect track end by checking if time is near duration
  useEffect(() => {
    if (!musicPlaying || !currentIsYt) return;
    const iv = setInterval(() => {
      const t = musicTimeRef.current;
      const d = musicDurationRef.current;
      if (d > 0 && t > 0 && t >= d - 1.5) {
        handleTrackEndRef.current();
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [musicPlaying, currentIsYt]);

  // When the YouTube iframe loads, tell it we want to listen for events.
  // Retry the handshake several times to handle the race where the iframe
  // loads before the effect attaches the listener.
  useEffect(() => {
    if (!currentTrack || !currentIsYt) return;
    // Reset time tracking for the new track
    musicTimeRef.current = 0;
    musicDurationRef.current = 0;
    setMusicTime(0);
    setMusicDuration(0);

    const iframe = ytIframeRef.current;
    if (!iframe) return;
    let done = false;

    function sendListening() {
      try {
        iframe!.contentWindow?.postMessage(
          JSON.stringify({ event: "listening", id: 1, channel: "widget" }),
          "*"
        );
      } catch {}
    }

    function onLoad() {
      sendListening();
      setMusicReady(true);
      done = true;
    }

    iframe.addEventListener("load", onLoad);

    // Retry in case the load event already fired before this effect ran
    const retries = [300, 800, 1500, 3000];
    const timers = retries.map((ms) =>
      setTimeout(() => {
        if (!done) sendListening();
      }, ms)
    );

    return () => {
      iframe.removeEventListener("load", onLoad);
      timers.forEach(clearTimeout);
    };
  }, [currentTrack?.url, currentIsYt, currentTrack]);

  // Load audio src when track changes (non-YouTube)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || currentIsYt) return;
    audio.src = currentTrack.url;
    audio.load();
    if (musicPlaying) audio.play().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.url, currentIsYt]);

  // Poll music current time / duration for non-YouTube tracks
  useEffect(() => {
    if (musicTracks.length === 0 || currentIsYt) return;
    const iv = setInterval(() => {
      if (audioRef.current) {
        const d = audioRef.current.duration;
        if (d && !isNaN(d)) setMusicDuration(d);
        if (musicPlaying) setMusicTime(audioRef.current.currentTime ?? 0);
      }
    }, 500);
    return () => clearInterval(iv);
  }, [musicPlaying, musicTracks.length, currentIsYt]);

  function toggleMusic() {
    const next = !musicPlaying;
    setMusicPlaying(next);
    if (currentIsYt) {
      if (next) {
        ytCommand("unMute");
        ytCommand("setVolume", [100]);
        ytCommand("playVideo");
        // Retry in case the iframe hasn't completed the listening handshake yet
        setTimeout(() => ytCommand("playVideo"), 500);
        setTimeout(() => ytCommand("playVideo"), 1500);
      } else {
        ytCommand("pauseVideo");
      }
    } else if (audioRef.current && currentTrack) {
      if (next) audioRef.current.play().catch(() => {});
      else audioRef.current.pause();
    }
  }

  function musicNext() {
    if (musicTracks.length <= 1) return;
    setMusicIdx((prev) => (prev + 1) % musicTracks.length);
  }
  function musicPrev() {
    if (musicTracks.length <= 1) return;
    setMusicIdx((prev) => (prev - 1 + musicTracks.length) % musicTracks.length);
  }
  function musicSkip(seconds: number) {
    if (currentIsYt) {
      ytCommand("seekTo", [Math.max(0, musicTimeRef.current + seconds), true]);
    } else if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime + seconds);
    }
  }

  // Inactivity tracker: reset on user interaction
  useEffect(() => {
    if (!sessionId) return;
    function onActivity() {
      lastActivityRef.current = Date.now();
      if (inactivityPrompt) {
        setInactivityPrompt(false);
        setIsPaused(false);
      }
    }
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });
    return () => { for (const e of events) window.removeEventListener(e, onActivity); };
  }, [sessionId, inactivityPrompt]);

  // Space key to pause/resume, F for fullscreen
  useEffect(() => {
    if (!sessionId) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.key === " ") {
        e.preventDefault();
        setIsPaused((v) => !v);
      }
      if (e.key === "F11" || (e.key === "f" && e.shiftKey)) {
        e.preventDefault();
        try {
          if (document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {});
          else document.documentElement.requestFullscreen?.()?.catch?.(() => {});
        } catch {}
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sessionId]);

  // Inactivity check interval
  useEffect(() => {
    if (!sessionId || isPaused || inactivityPrompt) return;
    const iv = setInterval(() => {
      const elapsed = (Date.now() - lastActivityRef.current) / 60_000;
      if (elapsed >= inactivityTimeout) {
        setIsPaused(true);
        setInactivityPrompt(true);
      }
    }, 5_000);
    return () => clearInterval(iv);
  }, [sessionId, isPaused, inactivityPrompt, inactivityTimeout]);

  // Auto-import external textbook PDFs into public Blob the first time a user
  // picks them, so all subsequent reads bypass /api/proxy/pdf entirely.
  useEffect(() => {
    if (!selectedDoc) return;
    if (selectedDoc.type !== "textbook") return;
    if (!selectedDoc.sourceUrl) return;
    if (selectedDoc.sourceUrl.includes("blob.vercel-storage.com")) return; // already a blob

    let cancelled = false;
    setImportingDoc(true);
    setImportError(null);

    fetch("/api/documents/ensure-imported", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceUrl: selectedDoc.sourceUrl,
        title: selectedDoc.title,
        textbookCatalogId: selectedDoc.documentId,
      }),
    })
      .then((r) => r.json())
      .then((data: { documentId?: string; fileUrl?: string; error?: string }) => {
        if (cancelled) return;
        if (data.error) {
          setImportError(`Could not cache book: ${data.error}. Using fallback.`);
          return;
        }
        if (data.fileUrl) {
          // Replace sourceUrl with the stored blob URL so getPdfUrl() serves
          // it directly — no proxy needed now or ever again for this book.
          setSelectedDoc((prev) =>
            prev ? { ...prev, sourceUrl: data.fileUrl } : prev
          );
        }
      })
      .catch(() => {
        if (!cancelled) setImportError("Could not cache book. Using fallback proxy.");
      })
      .finally(() => {
        if (!cancelled) setImportingDoc(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDoc?.documentId, selectedDoc?.sourceUrl, selectedDoc?.type]);

  const handlePageText = useCallback((page: number, text: string) => {
    setPageTexts((prev) => {
      if (prev.has(page)) return prev;
      const next = new Map(prev);
      next.set(page, text);
      return next;
    });
    accumulatedTextRef.current += `\n\n[Page ${page}]\n${text}`;
  }, []);

  const handleStart = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      const docPayload = selectedDoc
        ? { ...selectedDoc, selectedChapters }
        : null;

      // Offline path: skip the server entirely
      if (!navigator.onLine) {
        const tempId = enqueueOfflineSession({
          goalType,
          targetValue,
          documentJson: docPayload,
          startedAt: new Date().toISOString(),
          totalFocusedMinutes: 0,
          lastPageIndex: 1,
          pagesVisited: 0,
          visitedPagesList: [],
          completed: false,
        });
        setSessionId(tempId);
        setStarting(false);
        return;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch("/api/study/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalType, targetValue, documentJson: docPayload }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Server error (${res.status})`);
      }
      const data = await res.json();
      setSessionId(data.id);
    } catch (e) {
      // If a network error occurs mid-attempt, fall back to offline mode
      if (
        (e instanceof TypeError && e.message.includes("fetch")) ||
        (e instanceof DOMException && e.name === "AbortError")
      ) {
        const docPayload = selectedDoc ? { ...selectedDoc, selectedChapters } : null;
        const tempId = enqueueOfflineSession({
          goalType,
          targetValue,
          documentJson: docPayload,
          startedAt: new Date().toISOString(),
          totalFocusedMinutes: 0,
          lastPageIndex: 1,
          pagesVisited: 0,
          visitedPagesList: [],
          completed: false,
        });
        setSessionId(tempId);
        setStarting(false);
        return;
      }
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStarting(false);
    }
  }, [goalType, targetValue, selectedDoc, selectedChapters]);

  const currentPageRef = useRef(1);

  const saveProgress = useCallback(
    async (minutes: number) => {
      if (!sessionId || minutes <= lastSavedRef.current) return;
      lastSavedRef.current = minutes;

      const progressPayload = {
        totalFocusedMinutes: minutes,
        lastPageIndex: currentPageRef.current,
        pagesVisited: visitedPagesRef.current.size,
        visitedPagesList: Array.from(visitedPagesRef.current),
      };

      // Offline or temp session: update the local queue
      if (isOfflineId(sessionId)) {
        updateOfflineSession(sessionId, progressPayload);
        return;
      }

      try {
        await fetch("/api/study/sessions", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, ...progressPayload }),
        });
      } catch {
        // will retry on next tick
      }
    },
    [sessionId]
  );

  const handleEnd = useCallback(async () => {
    if (!sessionId) return;
    sessionEndingRef.current = true;
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch {}
    }

    if (accumulatedTextRef.current.trim()) {
      try {
        sessionStorage.setItem(`session-text-${sessionId}`, accumulatedTextRef.current);
      } catch {
        // storage may be full
      }
    }

    // Offline session: mark completed locally and let sync handle the rest
    if (isOfflineId(sessionId)) {
      updateOfflineSession(sessionId, {
        completed: true,
        endedAt: new Date().toISOString(),
        totalFocusedMinutes: focusedMinutesRef.current,
        pagesVisited: visitedPagesRef.current.size,
        visitedPagesList: Array.from(visitedPagesRef.current),
      });
      // Try to sync immediately (may succeed if connection came back)
      const synced = await syncOfflineSessions().catch(() => 0);
      if (synced > 0) {
        // Session synced — but we don't know the real ID yet from this path,
        // so send user to history instead of a specific summary.
        window.location.href = "/study/history";
      } else {
        // Still offline — show history (will list the pending session after sync)
        window.location.href = "/study/history";
      }
      return;
    }

    try {
      await fetch("/api/study/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          endedAt: new Date().toISOString(),
          totalFocusedMinutes: focusedMinutesRef.current,
          pagesVisited: visitedPagesRef.current.size,
          visitedPagesList: Array.from(visitedPagesRef.current),
        }),
      });
    } finally {
      window.location.href = `/study/session/${sessionId}/summary`;
    }
  }, [sessionId]);

  const goalTriggeredRef = useRef(false);
  const currentChapterIdxRef = useRef(0);

  const handlePageChange = useCallback((page: number) => {
    currentPageRef.current = page;
    setCurrentPage(page);
    if (!visitedPagesRef.current.has(page)) {
      visitedPagesRef.current.add(page);
      setVisitedPageCount(visitedPagesRef.current.size);
    }

    if (goalType !== "chapter" || selectedChapters.length === 0 || goalTriggeredRef.current) return;

    const ranges = selectedDoc?.chapterPageRanges;
    if (!ranges) return;

    const idx = currentChapterIdxRef.current;
    const ch = selectedChapters[idx];
    if (!ch) return;
    const range = ranges[ch];
    if (!range) return;

    // Trigger when the user navigates PAST the last page (> not >=), so they
    // can still read the final page of the chapter before the swap.
    if (page > range[1]) {
      const nextIdx = idx + 1;
      if (nextIdx < selectedChapters.length) {
        const nextCh = selectedChapters[nextIdx];
        const nextRange = ranges[nextCh];
        currentChapterIdxRef.current = nextIdx;
        setCurrentChapterIdx(nextIdx);
        if (nextRange) {
          setJumpTarget(nextRange[0]);
        }
      } else {
        goalTriggeredRef.current = true;
        handleEnd();
      }
    }
  }, [goalType, selectedChapters, selectedDoc?.chapterPageRanges, handleEnd]);

  function getPdfUrl(): string | null {
    if (!selectedDoc) return null;

    function serveBlobUrl(url: string): string {
      if (url.includes(".private.blob.vercel-storage.com")) {
        return `/api/blob/serve?url=${encodeURIComponent(url)}`;
      }
      return url;
    }

    if (selectedDoc.type === "upload") {
      if (selectedDoc.sourceUrl) {
        const isBlob = selectedDoc.sourceUrl.includes("blob.vercel-storage.com");
        if (isBlob) return serveBlobUrl(selectedDoc.sourceUrl);
        const isExternal = !selectedDoc.sourceUrl.startsWith("/");
        if (isExternal) return `/api/proxy/pdf?url=${encodeURIComponent(selectedDoc.sourceUrl)}`;
        return selectedDoc.sourceUrl;
      }
      return `/api/documents/${selectedDoc.documentId}/file`;
    }
    if (selectedDoc.type === "textbook" && selectedDoc.sourceUrl) {
      const isBlob = selectedDoc.sourceUrl.includes("blob.vercel-storage.com");
      if (isBlob) return serveBlobUrl(selectedDoc.sourceUrl);
      return `/api/proxy/pdf?url=${encodeURIComponent(selectedDoc.sourceUrl)}`;
    }
    return null;
  }

  function getStartPage(): number {
    if (goalType === "chapter" && selectedChapters.length > 0 && selectedDoc?.chapterPageRanges) {
      const firstChapter = selectedChapters[0];
      const range = selectedDoc.chapterPageRanges[firstChapter];
      return range ? range[0] : 1;
    }
    // For user uploads with a page offset, PDF page 1 maps to book page (1 + offset),
    // so the "start page" in book terms is (1 + offset).
    if (selectedDoc?.pageOffset) return 1 + selectedDoc.pageOffset;
    return selectedDoc?.startPage ?? 1;
  }

  function toggleChapter(ch: string) {
    setSelectedChapters((prev) => {
      if (prev.includes(ch)) return prev.filter((c) => c !== ch);
      if (prev.length >= targetValue) return prev;
      return [...prev, ch].sort((a, b) => Number(a) - Number(b));
    });
  }

  const hasChapterData = selectedDoc?.availableChapters && selectedDoc.availableChapters.length > 0;

  async function abandonActive() {
    if (!activeSession) return;
    await fetch("/api/study/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: activeSession.id, endedAt: new Date().toISOString(), totalFocusedMinutes: activeSession.totalFocusedMinutes ?? 0 }),
    });
    setActiveSession(null);
    setShowAbandonConfirm(false);
  }

  const pdfUrl = getPdfUrl();
  const startPage = getStartPage();

  // If there's no PDF to load, the timer can start immediately
  useEffect(() => {
    if (!pdfUrl) setDocReady(true);
  }, [pdfUrl]);

  /* ── Loading check ───────────────────────────────────────────── */
  if (checkingActive) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-gray-300 border-t-black animate-spin dark:border-gray-600 dark:border-t-white" />
      </main>
    );
  }

  /* ── Active session gate ─────────────────────────────────────── */
  if (activeSession && !sessionId) {
    return (
      <main className="min-h-screen px-6 py-10 md:px-10 max-w-lg mx-auto flex flex-col items-center justify-center">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 w-full dark:border-amber-700 dark:bg-amber-900/20">
          <h2 className="text-lg font-semibold text-amber-800 dark:text-amber-300 mb-2">
            You have an unfinished session
          </h2>
          <p className="text-sm text-amber-700 dark:text-amber-400 mb-1">
            {activeSession.goalType === "time"
              ? `${activeSession.targetValue} min goal`
              : `${activeSession.targetValue} chapter${activeSession.targetValue !== 1 ? "s" : ""}`}
            {" · "}{activeSession.totalFocusedMinutes}m studied so far
          </p>
          <p className="text-sm text-amber-600 dark:text-amber-500 mb-5">
            You need to resume or end it before starting a new session.
          </p>
          <div className="flex gap-3">
            <Link
              href={`/study/session?resume=${activeSession.id}`}
              className="flex-1 text-center rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-700 transition"
            >
              Resume session
            </Link>
            <button
              onClick={() => setShowAbandonConfirm(true)}
              className="flex-1 rounded-lg border border-amber-400 px-4 py-2.5 text-sm font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-400 dark:hover:bg-amber-900/30 transition"
            >
              End & start new
            </button>
          </div>
        </div>

        {showAbandonConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl bg-white border border-gray-200 p-6 shadow-2xl dark:bg-gray-900 dark:border-gray-700">
              <h3 className="text-base font-semibold mb-2">End unfinished session?</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
                This will save {activeSession.totalFocusedMinutes}m of progress and end the session. You can then start a new one.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setShowAbandonConfirm(false)} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800 transition">Cancel</button>
                <button onClick={abandonActive} className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition">Yes, end it</button>
              </div>
            </div>
          </div>
        )}

        <Link href="/dashboard" className="mt-6 text-sm underline underline-offset-4 text-gray-500">
          Back to dashboard
        </Link>
      </main>
    );
  }

  /* ── Setup screen ──────────────────────────────────────────────── */
  if (!sessionId) {
    return (
      <main className="min-h-screen px-6 py-10 md:px-10 max-w-2xl mx-auto">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-8">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold mb-2">Start a study session</h1>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
              Pick your reading material, set a goal, and start studying.
            </p>
          </div>
          <div
            className="shrink-0 text-sm text-gray-500 dark:text-gray-400 sm:text-right tabular-nums"
            title="PDFs stored in your browser offline cache (service worker). Turn on in Settings → Offline PDF cache."
          >
            {!pdfCacheOn ? (
              <span className="text-gray-500 dark:text-gray-400">PDF caching off</span>
            ) : pdfCacheEntryCount !== null ? (
              <>
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {pdfCacheEntryCount}
                </span>
                {" "}
                cached PDF{pdfCacheEntryCount === 1 ? "" : "s"}
              </>
            ) : (
              <span className="opacity-70">Cached PDFs: …</span>
            )}
          </div>
        </div>

        {/* Step 1: Document */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">1. Reading material</h2>
          {selectedDoc ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-lg border border-green-300 bg-green-50 p-3 dark:border-green-700 dark:bg-green-900/20">
                <span className="text-green-700 dark:text-green-400 text-sm font-medium flex-1">
                  {selectedDoc.title}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDoc(null);
                    setSelectedChapters([]);
                  }}
                  className="text-xs underline text-gray-500"
                >
                  Change
                </button>
              </div>
              {importingDoc && (
                <p className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 pl-1">
                  <span className="inline-block h-3 w-3 rounded-full border border-gray-400 border-t-transparent animate-spin" />
                  Preparing your book for fast loading…
                </p>
              )}
              {importError && (
                <p className="text-xs text-amber-600 dark:text-amber-400 pl-1">{importError}</p>
              )}
            </div>
          ) : (
            <DocumentPicker onSelect={setSelectedDoc} />
          )}
        </section>

        {/* Step 2: Goal */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">2. Study goal</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!selectedDoc) {
                setError("Pick reading material first");
                return;
              }
              if (goalType === "chapter" && hasChapterData && selectedChapters.length !== targetValue) {
                setError(`Select exactly ${targetValue} chapter${targetValue !== 1 ? "s" : ""}`);
                return;
              }
              try { document.documentElement.requestFullscreen?.()?.catch?.(() => {}); } catch {}
              handleStart();
            }}
            className="space-y-5"
          >
            <div>
              <label className="block text-sm font-medium mb-1.5">Goal type</label>
              <select
                value={goalType}
                onChange={(e) => {
                  setGoalType(e.target.value as GoalType);
                  setSelectedChapters([]);
                  setTargetValue(e.target.value === "time" ? 25 : 1);
                }}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
              >
                <option value="time">Time (minutes)</option>
                <option value="chapter">Chapters</option>
              </select>
            </div>

            {goalType === "time" ? (
              <div>
                <label className="block text-sm font-medium mb-1.5">Minutes</label>
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={targetValue}
                  onChange={(e) => setTargetValue(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                />
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    How many chapters do you want to read?
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={hasChapterData ? selectedDoc!.availableChapters!.length : 99}
                    value={targetValue}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setTargetValue(v);
                      setSelectedChapters((prev) => prev.slice(0, v));
                    }}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                  />
                </div>

                {hasChapterData && targetValue > 0 && (
                  <div>
                    <label className="block text-sm font-medium mb-2">
                      Which {targetValue} chapter{targetValue !== 1 ? "s" : ""} do you want to read?
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {selectedDoc!.availableChapters!.map((ch) => {
                        const isSelected = selectedChapters.includes(ch);
                        const isFull = selectedChapters.length >= targetValue && !isSelected;
                        const range = selectedDoc!.chapterPageRanges?.[ch];
                        return (
                          <button
                            key={ch}
                            type="button"
                            onClick={() => toggleChapter(ch)}
                            disabled={isFull}
                            className={`rounded-md border px-3 py-1.5 text-sm transition ${
                              isSelected
                                ? "btn-primary border-black dark:border-white"
                                : isFull
                                ? "border-gray-200 text-gray-300 cursor-not-allowed dark:border-gray-700 dark:text-gray-600"
                                : "border-gray-300 hover:border-gray-400 dark:border-gray-600"
                            }`}
                          >
                            Ch. {ch}
                            {range && (
                              <span className="ml-1 text-xs opacity-60">
                                (p.{range[0]}–{range[1]})
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      {selectedChapters.length} / {targetValue} selected
                      {selectedChapters.length > 0 && (
                        <span>
                          {" "}— Ch. {selectedChapters.join(", ")}
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </>
            )}

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={!selectedDoc || starting}
              className="btn-primary w-full rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {starting ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  Starting…
                </>
              ) : (
                "Start session"
              )}
            </button>
          </form>
        </section>

        <Link href="/" className="inline-block text-sm underline underline-offset-4">
          Back to home
        </Link>
      </main>
    );
  }

  /* ── Active session ────────────────────────────────────────────── */

  return (
    <VisibilityGuard
      onTabReturn={() => setIsPaused(true)}
      onResume={() => setIsPaused(false)}
    >
      <main className="h-dvh flex flex-col overflow-hidden">
        {/* Offline banner */}
        {!isOnline && (
          <div className="flex-shrink-0 flex items-center justify-center gap-2 bg-amber-900/80 px-4 py-1.5 text-xs font-medium text-amber-200">
            <span>⚡</span>
            <span>You&apos;re offline — your session is being saved locally and will sync when you reconnect.</span>
            {isOfflineId(sessionId ?? "") && <span className="text-amber-400">· AI features unavailable offline</span>}
          </div>
        )}
        {/* Top bar */}
        <header className="flex-shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-2 sm:px-6 sm:py-3 sm:gap-4 dark:border-gray-700">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold">
              {selectedDoc?.title ?? "Study session"}
            </h1>
            {isPaused && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Paused
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Music controls */}
            {musicTracks.length > 0 && (
              <div className="flex items-center gap-2">
                {/* Song info + progress bar */}
                {currentTrack && (
                  <div className="hidden sm:flex flex-col items-end gap-0.5 max-w-[200px] min-w-[120px]">
                    <div className="w-full overflow-hidden" title={currentTrack.title}>
                      <div className="marquee-container">
                        <span className="marquee-text text-[11px] font-medium whitespace-nowrap leading-tight">
                          {musicTracks.length > 1 && <span className="text-gray-400 mr-1">{musicIdx + 1}/{musicTracks.length}</span>}
                          {currentTrack.title}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 w-full">
                      <span className="text-[9px] tabular-nums text-gray-400 flex-shrink-0">
                        {musicDuration > 0 ? fmtTime(musicTime) : "-:--"}
                      </span>
                      <div className="flex-1 h-1 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-accent transition-all duration-300"
                          style={{ width: musicDuration > 0 ? `${(musicTime / musicDuration) * 100}%` : "0%" }}
                        />
                      </div>
                      <span className="text-[9px] tabular-nums text-gray-400 flex-shrink-0">
                        {musicDuration > 0 ? fmtTime(musicDuration) : "-:--"}
                      </span>
                    </div>
                  </div>
                )}
                {/* Transport buttons */}
                <div className="flex items-center gap-1">
                  {musicTracks.length > 1 && (
                    <button onClick={musicPrev} className="rounded-md border border-gray-300 dark:border-gray-600 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition" title="Previous">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                    </button>
                  )}
                  <button onClick={() => musicSkip(-10)} className="rounded-md border border-gray-300 dark:border-gray-600 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition" title="-10s">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                  </button>
                  <button
                    onClick={toggleMusic}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                      musicPlaying
                        ? "border-green-500 bg-green-50 text-green-700 dark:border-green-400 dark:bg-green-900/20 dark:text-green-300"
                        : "border-gray-300 dark:border-gray-600"
                    }`}
                    title={musicPlaying ? "Pause music" : "Play music"}
                  >
                    {musicPlaying ? "⏸" : "▶"}
                  </button>
                  <button onClick={() => musicSkip(10)} className="rounded-md border border-gray-300 dark:border-gray-600 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition" title="+10s">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                  </button>
                  {musicTracks.length > 1 && (
                    <button onClick={musicNext} className="rounded-md border border-gray-300 dark:border-gray-600 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition" title="Next">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 18h2V6h-2zM6 18l8.5-6L6 6z"/></svg>
                    </button>
                  )}
                </div>
              </div>
            )}
            <button
              onClick={() => setShowNotes((v) => !v)}
              disabled={!isOnline && isOfflineId(sessionId ?? "")}
              title={!isOnline && isOfflineId(sessionId ?? "") ? "AI Notes unavailable offline" : undefined}
              className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                showNotes
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-300"
                  : "border-gray-300 dark:border-gray-600"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {showNotes ? "Hide Notes" : "AI Notes"}
            </button>
            <OverrideFlow
              onConfirmEnd={handleEnd}
              locked
              sessionEndingRef={sessionEndingRef}
              requireExitPassword={!isOfflineId(sessionId ?? "")}
            />
          </div>
        </header>

        {/* Body */}
        <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
          {/* Timer sidebar */}
          <aside className="flex-shrink-0 border-b lg:border-b-0 lg:border-r border-gray-200 dark:border-gray-700 p-4 sm:p-6 lg:w-64 max-h-40 lg:max-h-none overflow-auto">
            <Timer
              goalType={goalType}
              targetValue={targetValue}
              isPaused={isPaused || !docReady || (pomodoroEnabled && pomodoroBreakActive)}
              onTick={(mins) => {
                focusedMinutesRef.current = mins;
                saveProgress(mins);
              }}
              onGoalReached={handleEnd}
            />
            {pomodoroEnabled && sessionId && (
              <div className="mt-4">
                <PomodoroTimer
                  focusMin={pomodoroFocus}
                  breakMin={pomodoroBreak}
                  longBreakMin={pomodoroLongBreak}
                  cyclesBeforeLong={pomodoroCyclesBeforeLong}
                  isPaused={isPaused || !docReady}
                  onPhaseChange={(phase) => setPomodoroBreakActive(phase !== "focus")}
                />
              </div>
            )}
            <div className="mt-4 text-xs text-gray-500 dark:text-gray-400 space-y-1">
              <p>Pages visited: {visitedPageCount}</p>
              {goalType === "chapter" && selectedChapters.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                  <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Chapters ({currentChapterIdx + 1}/{selectedChapters.length}):
                  </p>
                  {selectedChapters.map((ch, i) => {
                    const range = selectedDoc?.chapterPageRanges?.[ch];
                    const isCurrent = i === currentChapterIdx;
                    const isDone = i < currentChapterIdx;
                    return (
                      <p key={ch} className={isCurrent ? "font-semibold text-black dark:text-white" : ""}>
                        {isDone ? "✓ " : isCurrent ? "→ " : "  "}
                        Ch. {ch}
                        {range && <span className="opacity-60"> (p.{range[0]}–{range[1]})</span>}
                      </p>
                    );
                  })}
                </div>
              )}
              {!docReady && !isPaused && (
                <p className="text-amber-600 dark:text-amber-400 animate-pulse">Loading document…</p>
              )}
              <p>Stay on this tab to keep the timer running.</p>
            </div>

            {/* YouTube player — direct iframe embed, no API script needed */}
            {currentTrack && currentIsYt && parseYouTubeId(currentTrack.url) && (
              <div className="mt-4 rounded-lg overflow-hidden border border-gray-700">
                <iframe
                  ref={ytIframeRef}
                  key={currentTrack.url}
                  src={`https://www.youtube.com/embed/${parseYouTubeId(currentTrack.url)}?autoplay=${musicPlaying ? 1 : 0}&enablejsapi=1&controls=1&modestbranding=1&rel=0&playsinline=1&origin=${typeof window !== "undefined" ? encodeURIComponent(window.location.origin) : ""}`}
                  width="100%"
                  height="140"
                  allow="autoplay; encrypted-media"
                  style={{ border: 0, display: "block" }}
                  title="Music player"
                />
              </div>
            )}
          </aside>

          {/* Reader */}
          <section className="flex-1 min-h-0 overflow-auto p-3 lg:p-4 flex justify-center">
            {pdfUrl ? (
              <PdfViewer
                url={pdfUrl}
                initialPage={startPage}
                jumpToPage={jumpTarget}
                documentId={selectedDoc?.documentId}
                sessionId={sessionId ?? undefined}
                chapterPageRanges={selectedDoc?.chapterPageRanges}
                onPageChange={handlePageChange}
                onPageText={handlePageText}
                onLoad={() => setDocReady(true)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-center max-w-md py-20">
                <p className="text-4xl mb-4">📖</p>
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  {selectedDoc
                    ? "This textbook doesn't have a viewable PDF source. Use the timer alongside your physical book or another tab."
                    : "No document selected. End the session and start a new one with reading material."}
                </p>
              </div>
            )}
          </section>

          {/* AI Notes panel — always mounted so notes state is preserved on hide/show */}
          <aside className={`w-full lg:w-80 flex-shrink-0 border-t lg:border-t-0 lg:border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 h-[50dvh] lg:h-auto${showNotes ? "" : " hidden"}`}>
            <AiNotesPanel
              sessionId={sessionId}
              pageTexts={pageTexts}
              currentPage={currentPage}
              startPage={startPage}
              textbookCatalogId={selectedDoc?.type === "textbook" ? selectedDoc.documentId : undefined}
            />
          </aside>
        </div>

        {/* Inactivity prompt overlay */}
        {inactivityPrompt && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="mx-4 max-w-sm rounded-2xl bg-white p-8 text-center dark:bg-gray-900 shadow-2xl">
              <p className="text-4xl mb-4">👋</p>
              <h2 className="text-lg font-bold mb-2">Are you still reading?</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                No activity detected for {inactivityTimeout} minute{inactivityTimeout !== 1 ? "s" : ""}. The timer has been paused.
              </p>
              <button
                onClick={() => {
                  lastActivityRef.current = Date.now();
                  setInactivityPrompt(false);
                  setIsPaused(false);
                }}
                className="btn-primary w-full rounded-lg px-4 py-3 text-sm font-medium"
              >
                Yes, I&apos;m here!
              </button>
            </div>
          </div>
        )}

        {/* Hidden HTML audio for non-YouTube tracks */}
        <audio
          ref={audioRef}
          onEnded={handleTrackEnd}
          style={{ display: "none" }}
        />
      </main>
    </VisibilityGuard>
  );
}

