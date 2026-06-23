"use client";

import { useCallback, useRef, useState } from "react";
import type { ExitMethod } from "@/lib/exit-bosses";
import { EXIT_COOLDOWN_SEC } from "@/lib/exit-bosses";
import { ExitBossFight, type BossFightData } from "@/components/focus/ExitBossFight";
import { ExitCooldown } from "@/components/focus/ExitCooldown";
import { ExitPhraseGate } from "@/components/focus/ExitPhraseGate";
import { SuiText } from "@/components/ui-copy/UiCopyProvider";

type Phase =
  | "closed"
  | "confirm_off"
  | "cooldown"
  | "boss"
  | "phrase"
  | "victory"
  | "loading";

interface PhraseChallenge {
  token: string;
  phrase: string;
}

interface ExitGateFlowProps {
  sessionId: string;
  enabled: boolean;
  onConfirmEnd: (exitMethod: ExitMethod) => void;
  locked?: boolean;
  sessionEndingRef?: React.RefObject<boolean>;
  /** Live visited pages from the session UI (may be ahead of the DB). */
  getVisitedPages?: () => number[];
  /** Flush progress to the server before loading bosses. */
  onSyncBeforeBosses?: () => Promise<void>;
}

export function ExitGateFlow({
  sessionId,
  enabled,
  onConfirmEnd,
  locked = false,
  sessionEndingRef: _sessionEndingRef,
  getVisitedPages,
  onSyncBeforeBosses,
}: ExitGateFlowProps) {
  const [phase, setPhase] = useState<Phase>("closed");
  // All questions for the single boss fight (same persona, 3 sequential hit-questions)
  const [hitQuestions, setHitQuestions] = useState<BossFightData[]>([]);
  const [phraseChallenge, setPhraseChallenge] = useState<PhraseChallenge | null>(null);
  const [pendingExitMethod, setPendingExitMethod] = useState<ExitMethod>("boss_cleared");
  /** True when phrase gate is shown because no boss questions were available (not because of a failed fight). */
  const [phraseNoQuestions, setPhraseNoQuestions] = useState(false);
  const selfEndingRef = useRef(false);
  /** All bossId tokens shown in this session — sent back so the server can serve fresh questions. */
  const seenBossIdsRef = useRef<string[]>([]);

  const enterFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch {}
  }, []);

  const finishExit = useCallback(
    async (method: ExitMethod) => {
      selfEndingRef.current = true;
      setPhase("closed");
      if (document.fullscreenElement) {
        try { await document.exitFullscreen(); } catch {}
      }
      onConfirmEnd(method);
    },
    [onConfirmEnd]
  );

  const loadBosses = useCallback(async () => {
    setPhase("loading");
    try {
      await onSyncBeforeBosses?.();
      const pages = getVisitedPages?.() ?? [];
      const params = new URLSearchParams();
      if (pages.length > 0) params.set("pages", pages.join(","));
      if (seenBossIdsRef.current.length > 0) {
        params.set("seen", seenBossIdsRef.current.join(","));
      }
      const qs = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/study/sessions/${sessionId}/exit-bosses${qs}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setPhraseChallenge(data.phraseChallenge ?? null);
      const list = (data.bosses ?? []) as BossFightData[];
      // Record these bossIds so the next fight attempt gets fresh questions.
      list.forEach((b) => {
        if (!seenBossIdsRef.current.includes(b.bossId)) {
          seenBossIdsRef.current.push(b.bossId);
        }
      });
      setHitQuestions(list);
      if (list.length > 0) {
        setPhraseNoQuestions(false);
        setPhase("boss");
      } else {
        setPendingExitMethod("phrase_fallback");
        setPhraseNoQuestions(true);
        setPhase("phrase");
      }
    } catch {
      setPendingExitMethod("phrase_fallback");
      setPhraseNoQuestions(true);
      setPhase("phrase");
    }
  }, [sessionId, getVisitedPages, onSyncBeforeBosses]);

  const openGate = useCallback(() => {
    if (!enabled) {
      setPhase("confirm_off");
      return;
    }
    setPhase("cooldown");
    setHitQuestions([]);
    setPhraseChallenge(null);
    setPendingExitMethod("boss_cleared");
  }, [enabled]);

  // NOTE: fullscreenchange is intentionally NOT wired to openGate.
  // Only the manual "End Session" button should trigger the gate.
  // Escaping fullscreen falls through to the existing tab-blur / inactivity screen.

  function cancel() {
    setPhase("closed");
    if (locked) enterFullscreen();
  }

  function onBossDefeated() {
    setPhase("victory");
    setTimeout(() => finishExit("boss_cleared"), 1200);
  }

  function onRequirePhrase() {
    setPendingExitMethod("phrase_fallback");
    setPhraseNoQuestions(false);
    setPhase("phrase");
  }

  const showModal = phase !== "closed";

  return (
    <>
      <button
        type="button"
        onClick={openGate}
        className="rounded border border-red-500/40 px-3 py-1.5 text-sm text-red-600 dark:text-red-400"
      >
        <SuiText page="exit-boss" k="btn.end-session" def="End Session" as="span" />
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900 max-h-[90vh] overflow-y-auto">
            {phase === "confirm_off" && (
              <>
                <h2 className="text-base font-semibold mb-1">
                  <SuiText page="exit-boss" k="confirm.title" def="End session?" as="span" />
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  <SuiText page="exit-boss" k="confirm.subtitle" def="Progress will be saved." as="span" />
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={cancel}
                    className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600"
                  >
                    <SuiText page="exit-boss" k="btn.keep-studying" def="Keep studying" as="span" />
                  </button>
                  <button
                    type="button"
                    onClick={() => finishExit("gate_off")}
                    className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white"
                  >
                    <SuiText page="exit-boss" k="btn.end-session-confirm" def="End session" as="span" />
                  </button>
                </div>
              </>
            )}

            {phase === "cooldown" && (
              <>
                <h2 className="text-base font-semibold mb-3">
                  <SuiText page="exit-boss" k="cooldown.heading" def="Boss Beacons" as="span" />
                </h2>
                <ExitCooldown
                  seconds={EXIT_COOLDOWN_SEC}
                  onDone={loadBosses}
                  onCancel={cancel}
                />
              </>
            )}

            {phase === "loading" && (
              <p className="text-sm text-gray-500 dark:text-gray-400 animate-pulse py-8 text-center">
                <SuiText page="exit-boss" k="loading.text" def="Summoning distraction sprites…" as="span" />
              </p>
            )}

            {phase === "boss" && hitQuestions.length > 0 && (
              <>
                <h2 className="text-base font-semibold mb-3">
                  <SuiText page="exit-boss" k="boss.heading" def="Boss Beacon" as="span" />
                </h2>
                <ExitBossFight
                  hitQuestions={hitQuestions}
                  onDefeated={onBossDefeated}
                  onRequirePhrase={onRequirePhrase}
                  onCancel={cancel}
                  sessionId={sessionId}
                />
              </>
            )}

            {phase === "phrase" && phraseChallenge && (
              <>
                <h2 className="text-base font-semibold mb-1">
                  {phraseNoQuestions ? (
                    <SuiText page="exit-boss" k="boss.heading" def="Boss Beacon" as="span" />
                  ) : (
                    <SuiText page="exit-boss" k="phrase.heading" def="Unlock the exit" as="span" />
                  )}
                </h2>
                {phraseNoQuestions && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    <SuiText page="exit-boss" k="phrase.no-questions" def="No content challenges available — type the phrase to exit." as="span" />
                  </p>
                )}
                <ExitPhraseGate
                  phrase={phraseChallenge.phrase}
                  token={phraseChallenge.token}
                  sessionId={sessionId}
                  onSuccess={() => finishExit(pendingExitMethod)}
                  onCancel={cancel}
                />
              </>
            )}

            {phase === "phrase" && !phraseChallenge && (
              <p className="text-sm text-red-600">Could not load phrase challenge.</p>
            )}

            {phase === "victory" && (
              <div className="text-center py-6">
                <p className="text-4xl mb-2">✨</p>
                <h2 className="text-lg font-bold text-green-600 dark:text-green-400">
                  <SuiText page="exit-boss" k="victory.title" def="Beacon secured!" as="span" />
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  <SuiText page="exit-boss" k="victory.subtitle" def="Landing the session…" as="span" />
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
