"use client";

import { useState, useMemo } from "react";
import {
  PLAYER_MAX_HP,
  randomBossCounterAttack,
  randomPlayerDamage,
} from "@/lib/exit-bosses";
import { SuiText } from "@/components/ui-copy/UiCopyProvider";

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
  onRequirePhrase: (opts?: { defeated?: boolean }) => void;
  onCancel: () => void;
  sessionId: string;
}

type AttackPhase = "idle" | "raising" | "firing" | "blocked" | "bossCounter";
type AttackStyle = "scribble" | "ink" | "eraser";

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

// ── CSS-drawn student sprite ──────────────────────────────────────────────────
function PlayerSprite({
  wandRaised,
  playerShake,
}: {
  wandRaised: boolean;
  playerShake: boolean;
}) {
  return (
    <div className={playerShake ? "animate-player-shake" : ""}>
      <div style={{ position: "relative", width: 54, height: 82 }}>
        {/* Head */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 17,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "#c8956c",
            overflow: "hidden",
          }}
        >
          {/* Hair */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 11,
              background: "#2d1b0e",
              borderRadius: "50% 50% 0 0",
            }}
          />
          {/* Left eye */}
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 4,
              width: 3,
              height: 3,
              borderRadius: "50%",
              background: "#1a1a1a",
            }}
          />
          {/* Right eye */}
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 4,
              width: 3,
              height: 3,
              borderRadius: "50%",
              background: "#1a1a1a",
            }}
          />
        </div>

        {/* Body / shirt */}
        <div
          style={{
            position: "absolute",
            top: 22,
            left: 18,
            width: 18,
            height: 24,
            background: "#1e40af",
            borderRadius: "3px 3px 0 0",
          }}
        >
          {/* Collar */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 5,
              width: 8,
              height: 5,
              background: "#f1f5f9",
              borderRadius: "0 0 50% 50%",
            }}
          />
        </div>

        {/* Left arm — passive */}
        <div
          style={{
            position: "absolute",
            top: 25,
            left: 10,
            width: 7,
            height: 17,
            background: "#c8956c",
            borderRadius: 4,
            transform: "rotate(12deg)",
            transformOrigin: "top center",
          }}
        />

        {/* Right arm — wand arm, raises on attack */}
        <div
          style={{
            position: "absolute",
            top: 23,
            right: 8,
            width: 7,
            height: 17,
            background: "#c8956c",
            borderRadius: 4,
            transform: wandRaised ? "rotate(-75deg)" : "rotate(-18deg)",
            transformOrigin: "top center",
            transition: "transform 0.22s cubic-bezier(0.34,1.56,0.64,1)",
          }}
        >
          {/* Pencil wand extending from hand */}
          <div
            style={{
              position: "absolute",
              bottom: -20,
              left: 1,
              width: 5,
              height: 22,
              background: "linear-gradient(180deg,#fde68a 0%,#fbbf24 100%)",
              borderRadius: "2px 2px 0 0",
            }}
          >
            {/* Pink eraser cap */}
            <div
              style={{
                position: "absolute",
                top: -5,
                left: 0,
                width: 5,
                height: 5,
                background: "#fda4af",
                borderRadius: "2px 2px 0 0",
              }}
            />
            {/* Pencil tip (triangle via border trick) */}
            <div
              style={{
                position: "absolute",
                bottom: -6,
                left: 0,
                right: 0,
                margin: "0 auto",
                width: 0,
                height: 0,
                borderLeft: "2.5px solid transparent",
                borderRight: "2.5px solid transparent",
                borderTop: "6px solid #fbbf24",
              }}
            />
          </div>
        </div>

        {/* Legs */}
        <div
          style={{
            position: "absolute",
            top: 46,
            left: 15,
            display: "flex",
            gap: 4,
          }}
        >
          {([0, 1] as const).map((i) => (
            <div
              key={i}
              style={{
                position: "relative",
                width: 8,
                height: 24,
                background: "#1e3a8a",
                borderRadius: "2px 2px 4px 4px",
              }}
            >
              {/* Shoe */}
              <div
                style={{
                  position: "absolute",
                  bottom: -4,
                  left: -1,
                  width: 10,
                  height: 5,
                  background: "#111827",
                  borderRadius: "0 0 4px 4px",
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Projectile visuals ────────────────────────────────────────────────────────
function ScribbleBolt() {
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      {/* Main bolt body — gold hexagon/pointed shape */}
      <div
        style={{
          width: 62,
          height: 10,
          background: "linear-gradient(to right, #fef08a, #f59e0b)",
          clipPath:
            "polygon(0% 50%, 12% 0%, 88% 0%, 100% 50%, 88% 100%, 12% 100%)",
          filter: "drop-shadow(0 0 5px #fbbf24)",
        }}
      />
      {/* Spark dot above */}
      <div
        style={{
          position: "absolute",
          top: -4,
          left: "38%",
          width: 4,
          height: 4,
          borderRadius: "50%",
          background: "#fef08a",
          opacity: 0.8,
        }}
      />
      {/* Spark dot below */}
      <div
        style={{
          position: "absolute",
          bottom: -4,
          left: "58%",
          width: 3,
          height: 3,
          borderRadius: "50%",
          background: "#fef08a",
          opacity: 0.8,
        }}
      />
    </div>
  );
}

function InkSplash() {
  return (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: "50%",
        background:
          "radial-gradient(circle at 38% 35%, #e879f9 0%, #7c3aed 65%, #4c1d95 100%)",
        boxShadow: "0 0 10px #a855f7, 0 0 22px rgba(168,85,247,0.45)",
      }}
    />
  );
}

function EraserSmash() {
  return (
    <div
      style={{
        position: "relative",
        width: 30,
        height: 15,
        background: "linear-gradient(135deg, #fecdd3, #fda4af)",
        borderRadius: 3,
        border: "1.5px solid #f472b6",
        boxShadow: "0 2px 8px rgba(244,114,182,0.55)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 4,
          left: 3,
          right: 3,
          height: 1,
          background: "rgba(244,114,182,0.6)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 3,
          right: 3,
          height: 1,
          background: "rgba(244,114,182,0.6)",
        }}
      />
    </div>
  );
}

/** Boss-themed projectile flying toward the player (right → left). */
function BossCounterProjectile({ bossKey }: { bossKey: string }) {
  if (bossKey === "scroll_serpent") {
    return (
      <div
        style={{
          width: 48,
          height: 12,
          borderRadius: 6,
          background: "linear-gradient(to left, #34d399, #059669)",
          boxShadow: "0 0 12px rgba(52,211,153,0.7)",
        }}
      />
    );
  }
  if (bossKey === "phone_goblin") {
    return (
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "radial-gradient(circle, #fdba74, #ea580c)",
          boxShadow: "0 0 14px rgba(249,115,22,0.8)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
        }}
      >
        🔔
      </div>
    );
  }
  if (bossKey === "snooze_slime") {
    return (
      <div
        style={{
          fontSize: "1.25rem",
          letterSpacing: 2,
          filter: "drop-shadow(0 0 6px #38bdf8)",
        }}
      >
        💤💤
      </div>
    );
  }
  // tab_wraith default
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        background:
          "radial-gradient(circle at 35% 35%, #ddd6fe, #7c3aed 70%, #4c1d95)",
        boxShadow: "0 0 16px rgba(139,92,246,0.85)",
        opacity: 0.95,
      }}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function ExitBossFight({
  hitQuestions,
  onDefeated,
  onRequirePhrase,
  onCancel,
  sessionId,
}: ExitBossFightProps) {
  const [hitIndex, setHitIndex] = useState(0);
  const [hitsLanded, setHitsLanded] = useState(0);
  const [bossHpPercent, setBossHpPercent] = useState(100);
  const [playerHpPercent, setPlayerHpPercent] = useState(PLAYER_MAX_HP);
  const [attempts, setAttempts] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackType, setFeedbackType] = useState<"success" | "error" | "defeat">("error");
  const [bossShake, setBossShake] = useState(false);
  const [playerShake, setPlayerShake] = useState(false);
  const [attackPhase, setAttackPhase] = useState<AttackPhase>("idle");
  const [bossHpFlash, setBossHpFlash] = useState(false);
  const [playerHpFlash, setPlayerHpFlash] = useState(false);
  const [grading, setGrading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [playerDefeated, setPlayerDefeated] = useState(false);

  // Randomly decide 2–4 hits, assign random damage, and pick attack style —
  // all stable for the lifetime of this fight.
  const { activeQuestions, damageChunks, attackStyle } = useMemo(() => {
    const n = Math.min(
      hitQuestions.length,
      2 + Math.floor(Math.random() * 3) // 2, 3, or 4
    );
    const styles: AttackStyle[] = ["scribble", "ink", "eraser"];
    const style = styles[Math.floor(Math.random() * styles.length)];
    return {
      activeQuestions: hitQuestions.slice(0, n),
      damageChunks: randomDamageChunks(n),
      attackStyle: style,
    };
  }, [hitQuestions]);

  const totalHits = activeQuestions.length;

  // Boss persona always comes from the first question (all share the same persona)
  const boss = activeQuestions[0];
  const currentQ = activeQuestions[Math.min(hitIndex, totalHits - 1)];

  const bossHpColor =
    bossHpPercent > 55 ? "bg-green-400" : bossHpPercent > 25 ? "bg-yellow-400" : "bg-red-500";
  const playerHpColor =
    playerHpPercent > 55 ? "bg-sky-400" : playerHpPercent > 25 ? "bg-amber-400" : "bg-red-500";

  const wandRaised = attackPhase !== "idle";

  async function attack(selectedIndex: number) {
    if (grading || transitioning || attackPhase !== "idle" || playerDefeated) return;
    setGrading(true);
    setSelected(selectedIndex);
    setFeedback(null);

    // Immediately raise the wand arm
    setAttackPhase("raising");

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

        // Fire the projectile
        setTimeout(() => setAttackPhase("firing"), 220);

        // Boss takes the hit
        setTimeout(() => {
          setBossShake(true);
          setBossHpFlash(true);
          const newHp = Math.max(0, bossHpPercent - damageChunks[hitIndex]);
          setBossHpPercent(newHp);
          setTimeout(() => setBossShake(false), 600);
        }, 560);

        // Return to idle
        setTimeout(() => setAttackPhase("idle"), 1050);

        if (newHitsLanded >= totalHits) {
          setFeedbackType("success");
          setFeedback(
            data.explanation ? `⚡ ${data.explanation}` : "⚡ Final blow! Boss defeated!"
          );
          setTimeout(() => onDefeated(), 1300);
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
            setSelected(null);
            setBossHpFlash(false);
            setTransitioning(false);
          }, 1200);
        }
      } else {
        const nextAttempts = attempts + 1;
        setAttempts(nextAttempts);

        // Player bolt blocked
        setTimeout(() => setAttackPhase("blocked"), 220);

        // Boss counter-attack after the blocked bolt returns
        setTimeout(() => {
          setAttackPhase("bossCounter");
          const counter = randomBossCounterAttack(boss.bossKey);
          const dmg = randomPlayerDamage();
          const newPlayerHp = Math.max(0, playerHpPercent - dmg);
          setPlayerHpPercent(newPlayerHp);
          setPlayerHpFlash(true);
          setPlayerShake(true);
          setFeedbackType("error");
          setFeedback(`${counter.name}! ${counter.message}`);

          setTimeout(() => {
            setPlayerShake(false);
            setPlayerHpFlash(false);
            setAttackPhase("idle");

            if (newPlayerHp <= 0) {
              setPlayerDefeated(true);
              setTransitioning(true);
              setFeedbackType("defeat");
              setFeedback("You succumbed to distraction. Type the phrase to unlock the exit.");
              setTimeout(() => onRequirePhrase({ defeated: true }), 2200);
              return;
            }

            if (nextAttempts >= 2) {
              const hasNext = hitIndex + 1 < totalHits;
              setTransitioning(true);
              if (hasNext) {
                setFeedback(
                  data.explanation
                    ? `Answer: ${data.explanation} — next challenge…`
                    : "Moving to the next challenge…"
                );
                setTimeout(() => {
                  setHitIndex((h) => h + 1);
                  setAttempts(0);
                  setFeedback(null);
                  setSelected(null);
                  setTransitioning(false);
                }, 1400);
              } else {
                setFeedback(
                  data.explanation
                    ? `Answer: ${data.explanation} — the boss shields the exit.`
                    : "The boss shields the exit."
                );
                setTimeout(() => onRequirePhrase(), 1600);
              }
            } else {
              setFeedback(
                data.explanation
                  ? `Blocked! ${data.explanation} — try once more.`
                  : "Blocked! Try once more."
              );
              setSelected(null);
            }
          }, 650);
        }, 900);
      }
    } catch {
      setAttackPhase("idle");
      setFeedbackType("error");
      setFeedback("Something went wrong. Try again.");
    } finally {
      setGrading(false);
    }
  }

  // Which Tailwind animation class to apply to the projectile
  const projectileAnimClass =
    attackPhase === "firing"
      ? attackStyle === "scribble"
        ? "animate-bolt-fly"
        : attackStyle === "ink"
        ? "animate-ink-fly"
        : "animate-eraser-bounce"
      : "animate-bolt-blocked"; // "blocked" phase

  return (
    <div className="space-y-4">
      {/* Boss arena */}
      <div
        className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${boss.colorClass} shadow-lg ${bossShake ? "animate-boss-shake" : ""}`}
        style={{ minHeight: "11rem" }}
      >
        {/* Dark atmospheric overlay */}
        <div className="pointer-events-none absolute inset-0 bg-black/30" />

        {/* ── Player projectile (right) ── */}
        {(attackPhase === "firing" || attackPhase === "blocked") && (
          <div
            className={projectileAnimClass}
            style={{
              position: "absolute",
              left: 88,
              top: "27%",
              zIndex: 20,
            }}
          >
            {attackStyle === "scribble" && <ScribbleBolt />}
            {attackStyle === "ink" && <InkSplash />}
            {attackStyle === "eraser" && <EraserSmash />}
          </div>
        )}

        {/* ── Boss counter-attack (flies left toward player) ── */}
        {attackPhase === "bossCounter" && (
          <div
            className="animate-boss-counter-fly"
            style={{
              position: "absolute",
              right: 72,
              top: "30%",
              zIndex: 20,
            }}
          >
            <BossCounterProjectile bossKey={boss.bossKey} />
          </div>
        )}

        <div className="relative z-10 flex items-end justify-between px-5 pb-4 pt-5">
          {/* ── Player sprite (left) ── */}
          <div className="flex flex-col items-center gap-1 select-none">
            <PlayerSprite wandRaised={wandRaised} playerShake={playerShake} />
            <span className="text-white/60 text-[9px] font-bold tracking-widest uppercase">
              You
            </span>
            {/* Player HP */}
            <div className="w-[72px] mt-1">
              <div className="mb-0.5 flex justify-between text-[8px] font-bold text-white/70">
                <span>YOU</span>
                <span className={playerHpFlash ? "animate-hp-flash" : ""}>
                  {playerHpPercent}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-black/50">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${playerHpColor}`}
                  style={{ width: `${playerHpPercent}%` }}
                />
              </div>
            </div>
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

        {/* Boss HP bar — full-width at bottom of card */}
        <div className="relative z-10 px-5 pb-4">
          <div className="mb-1 flex justify-between text-[10px] font-bold text-white/80">
            <span><SuiText page="exit-boss" k="boss.hp-label" def="BOSS HP" as="span" /></span>
            <span className={bossHpFlash ? "animate-hp-flash" : ""}>{bossHpPercent}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-black/50">
            <div
              className={`h-full rounded-full transition-all duration-700 ${bossHpColor}`}
              style={{ width: `${bossHpPercent}%` }}
            />
          </div>
        </div>
      </div>

      {playerDefeated ? (
        <div className="rounded-xl border border-red-500/40 bg-red-950/30 px-4 py-6 text-center">
          <p className="text-3xl mb-2">💀</p>
          <h3 className="text-base font-bold text-red-500 dark:text-red-400">
            Distraction wins!
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Your focus HP hit zero. Unlocking the phrase gate…
          </p>
        </div>
      ) : (
      <>
      <div>
        <p className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
          {currentQ.question}
        </p>
        <div className="grid gap-2">
          {currentQ.options.map((opt, i) => (
            <button
              key={i}
              type="button"
              disabled={grading || transitioning || attackPhase !== "idle"}
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
              : feedbackType === "defeat"
              ? "text-red-600 dark:text-red-400"
              : "text-amber-600 dark:text-amber-400"
          }`}
        >
          {feedback}
        </p>
      )}

      <button
        type="button"
        onClick={onCancel}
        disabled={playerDefeated}
        className="w-full rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-500 dark:border-gray-600 dark:text-gray-400 disabled:opacity-40"
      >
        <SuiText page="exit-boss" k="btn.keep-studying" def="Keep studying" as="span" />
      </button>
      </>
      )}
    </div>
  );
}
