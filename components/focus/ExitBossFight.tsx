"use client";

import { useState, useMemo } from "react";

export interface BossFightData {
  bossId: string;
  bossKey: string;
  name: string;
  taunt: string;
  emoji: string;
  colorClass: string;
  question: string;
  options: [string, string, string, string];
}

interface ExitBossFightProps {
  /** All hit-questions for this boss (same persona, sequential questions). */
  hitQuestions: BossFightData[];
  onDefeated: () => void;
  onRequirePhrase: () => void;
  onCancel: () => void;
  sessionId: string;
}

/** Distribute 100 HP into `hits` random chunks, each at least 10. */
function randomDamageChunks(hits: number): number[] {
  const MIN = 10;
  const pool = 100 - MIN * hits;
  const raw = Array.from({ length: hits }, () => Math.random());
  const sum = raw.reduce((a, b) => a + b, 0);
  const damages = raw.map((v) => MIN + Math.round((v / sum) * pool));
  // Fix rounding drift so they sum to exactly 100
  const diff = 100 - damages.reduce((a, b) => a + b, 0);
  damages[damages.length - 1] += diff;
  return damages;
}

export function ExitBossFight({
  hitQuestions,
  onDefeated,
  onRequirePhrase,
  onCancel,
  sessionId,
}: ExitBossFightProps) {
  const [hitIndex, setHitIndex] = useState(0);
  const [hitsLanded, setHitsLanded] = useState(0);
  const [hpPercent, setHpPercent] = useState(100);
  const [attempts, setAttempts] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackType, setFeedbackType] = useState<"success" | "error">("error");
  const [bossShake, setBossShake] = useState(false);
  const [playerShake, setPlayerShake] = useState(false);
  const [playerAttack, setPlayerAttack] = useState(false);
  const [hpFlash, setHpFlash] = useState(false);
  const [grading, setGrading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  // Randomly decide 2–4 hits and assign random damage per hit — stable for lifetime.
  const { activeQuestions, damageChunks } = useMemo(() => {
    const n = Math.min(
      hitQuestions.length,
      2 + Math.floor(Math.random() * 3) // 2, 3, or 4
    );
    return {
      activeQuestions: hitQuestions.slice(0, n),
      damageChunks: randomDamageChunks(n),
    };
  }, [hitQuestions]);

  const totalHits = activeQuestions.length;

  // Boss persona always comes from the first question (all share the same persona)
  const boss = activeQuestions[0];
  const currentQ = activeQuestions[Math.min(hitIndex, totalHits - 1)];

  const hpColor =
    hpPercent > 55 ? "bg-green-400" : hpPercent > 25 ? "bg-yellow-400" : "bg-red-500";

  async function attack(selectedIndex: number) {
    if (grading || transitioning) return;
    setGrading(true);
    setSelected(selectedIndex);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/study/sessions/${sessionId}/exit-bosses/grade`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bossId: currentQ.bossId, selectedIndex }),
        }
      );
      const data = await res.json();

      if (data.correct) {
        const newHitsLanded = hitsLanded + 1;
        setHitsLanded(newHitsLanded);
        setTransitioning(true);

        // Animate player lunging forward
        setPlayerAttack(true);
        setTimeout(() => setPlayerAttack(false), 600);

        // Delay boss reaction slightly so player reaches first
        setTimeout(() => {
          setBossShake(true);
          setHpFlash(true);
          const newHp = Math.max(0, hpPercent - damageChunks[hitIndex]);
          setHpPercent(newHp);
          setTimeout(() => setBossShake(false), 600);
        }, 280);

        if (newHitsLanded >= totalHits) {
          setFeedbackType("success");
          setFeedback(
            data.explanation ? `⚡ ${data.explanation}` : "⚡ Final blow! Boss defeated!"
          );
          setTimeout(() => onDefeated(), 1200);
        } else {
          setFeedbackType("success");
          setFeedback(
            data.explanation
              ? `⚔️ Hit! ${data.explanation}`
              : "⚔️ Hit! Keep attacking!"
          );
          setTimeout(() => {
            setHitIndex((h) => h + 1);
            setAttempts(0);
            setFeedback(null);
            setSelected(null);
            setHpFlash(false);
            setTransitioning(false);
          }, 1100);
        }
      } else {
        const nextAttempts = attempts + 1;
        setAttempts(nextAttempts);
        setPlayerShake(true);
        setTimeout(() => setPlayerShake(false), 500);

        if (nextAttempts >= 2) {
          setFeedbackType("error");
          setFeedback("The boss shields the exit. Type the unlock phrase instead.");
          setTransitioning(true);
          setTimeout(() => onRequirePhrase(), 1200);
        } else {
          setFeedbackType("error");
          setFeedback(
            data.explanation
              ? `Blocked! ${data.explanation} — try once more.`
              : "Blocked! Try once more."
          );
          setSelected(null);
        }
      }
    } catch {
      setFeedbackType("error");
      setFeedback("Something went wrong. Try again.");
    } finally {
      setGrading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Boss arena */}
      <div
        className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${boss.colorClass} shadow-lg ${bossShake ? "animate-boss-shake" : ""}`}
        style={{ minHeight: "11rem" }}
      >
        {/* Dark atmospheric overlay */}
        <div className="pointer-events-none absolute inset-0 bg-black/30" />

        <div className="relative z-10 flex items-end justify-between px-5 pb-4 pt-5">
          {/* ── Player sprite (left) ── */}
          <div
            className={`flex flex-col items-center gap-1 select-none ${playerAttack ? "animate-player-attack" : ""} ${playerShake ? "animate-player-shake" : ""}`}
          >
            {/* Pencil body */}
            <div className="relative flex flex-col items-center" style={{ width: 28 }}>
              {/* Eraser */}
              <div className="w-5 h-3 rounded-t-sm bg-pink-300 border border-pink-400" />
              {/* Metal band */}
              <div className="w-5 h-1.5 bg-gray-300" />
              {/* Yellow body */}
              <div className="w-5 h-10 bg-yellow-300 border-x border-yellow-400 flex items-center justify-center">
                {/* Face */}
                <div className="flex flex-col items-center gap-0.5 mt-0.5">
                  <div className="flex gap-1">
                    <div className="w-1 h-1 rounded-full bg-gray-700" />
                    <div className="w-1 h-1 rounded-full bg-gray-700" />
                  </div>
                  <div className="w-2 h-0.5 rounded-full bg-gray-700 mt-0.5" />
                </div>
              </div>
              {/* Tip */}
              <div
                style={{
                  width: 0,
                  height: 0,
                  borderLeft: "10px solid transparent",
                  borderRight: "10px solid transparent",
                  borderTop: "10px solid #854d0e",
                }}
              />
              <div
                style={{
                  width: 0,
                  height: 0,
                  borderLeft: "5px solid transparent",
                  borderRight: "5px solid transparent",
                  borderTop: "6px solid #1c1917",
                }}
              />
            </div>
            <span className="text-white/60 text-[9px] font-bold tracking-widest uppercase">You</span>
          </div>

          {/* ── Boss sprite (right) ── */}
          <div className="flex flex-col items-center gap-0.5 text-white">
            <div
              style={{
                fontSize: "4rem",
                lineHeight: 1,
                filter: bossShake
                  ? "brightness(2) drop-shadow(0 0 18px rgba(255,230,50,1))"
                  : "drop-shadow(0 4px 14px rgba(0,0,0,0.6))",
                transition: "filter 0.2s",
              }}
            >
              {boss.emoji}
            </div>
            <h3 className="text-base font-extrabold tracking-wide drop-shadow">{boss.name}</h3>
            <p className="text-[10px] italic opacity-70 max-w-[140px] text-center leading-tight">
              &ldquo;{boss.taunt}&rdquo;
            </p>
          </div>
        </div>

        {/* HP bar — full-width at bottom of card */}
        <div className="relative z-10 px-5 pb-4">
          <div className="mb-1 flex justify-between text-[10px] font-bold text-white/80">
            <span>BOSS HP</span>
            <span className={hpFlash ? "animate-hp-flash" : ""}>{hpPercent}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-black/50">
            <div
              className={`h-full rounded-full transition-all duration-700 ${hpColor}`}
              style={{ width: `${hpPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Question + answers */}
      <div>
        <p className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
          {currentQ.question}
        </p>
        <div className="grid gap-2">
          {currentQ.options.map((opt, i) => (
            <button
              key={i}
              type="button"
              disabled={grading || transitioning}
              onClick={() => attack(i)}
              className={`rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all ${
                selected === i
                  ? "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100"
                  : "border-gray-300 hover:border-violet-400 hover:bg-violet-50 dark:border-gray-600 dark:hover:bg-violet-900/30"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <span className="mr-2 font-mono text-xs text-gray-400 dark:text-gray-500">
                {["A", "B", "C", "D"][i]}
              </span>
              {opt}
            </button>
          ))}
        </div>
      </div>

      {feedback && (
        <p
          className={`text-center text-xs font-medium ${
            feedbackType === "success"
              ? "text-green-600 dark:text-green-400"
              : "text-amber-600 dark:text-amber-400"
          }`}
        >
          {feedback}
        </p>
      )}

      <button
        type="button"
        onClick={onCancel}
        className="w-full rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-500 dark:border-gray-600 dark:text-gray-400"
      >
        Keep studying
      </button>
    </div>
  );
}
