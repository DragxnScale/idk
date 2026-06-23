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

export function ExitBossFight({
  hitQuestions,
  onDefeated,
  onRequirePhrase,
  onCancel,
  sessionId,
}: ExitBossFightProps) {
  const totalHits = activeQuestions.length;

  const [hitIndex, setHitIndex] = useState(0);
  const [hitsLanded, setHitsLanded] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackType, setFeedbackType] = useState<"success" | "error">("error");
  const [bossShake, setBossShake] = useState(false);
  const [playerShake, setPlayerShake] = useState(false);
  const [hpFlash, setHpFlash] = useState(false);
  const [grading, setGrading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  // Randomly decide 2–4 hits for this fight; stable for the component's lifetime.
  const activeQuestions = useMemo(() => {
    const n = Math.min(
      hitQuestions.length,
      2 + Math.floor(Math.random() * 3) // 2, 3, or 4
    );
    return hitQuestions.slice(0, n);
  }, [hitQuestions]);

  // Boss persona always comes from the first question (all share the same persona)
  const boss = activeQuestions[0];
  const currentQ = activeQuestions[Math.min(hitIndex, activeQuestions.length - 1)];

  const hpPercent = Math.round(((totalHits - hitsLanded) / totalHits) * 100);
  const hpColor =
    hpPercent > 60 ? "bg-green-400" : hpPercent > 30 ? "bg-yellow-400" : "bg-red-500";

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
        setBossShake(true);
        setHpFlash(true);
        setTransitioning(true);

        setTimeout(() => setBossShake(false), 600);

        if (newHitsLanded >= totalHits) {
          setFeedbackType("success");
          setFeedback(
            data.explanation ? `⚡ ${data.explanation}` : "⚡ Final blow! Boss defeated!"
          );
          setTimeout(() => onDefeated(), 1000);
        } else {
          setFeedbackType("success");
          setFeedback(
            data.explanation
              ? `Hit ${newHitsLanded}/${totalHits}! ${data.explanation}`
              : `⚔️ Hit ${newHitsLanded}/${totalHits}! Keep going!`
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
        className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${boss.colorClass} p-5 text-white shadow-lg ${bossShake ? "animate-boss-shake" : ""}`}
      >
        {/* Dark atmospheric overlay */}
        <div className="pointer-events-none absolute inset-0 rounded-2xl bg-black/25" />

        <div className="relative z-10 text-center">
          {/* Giant boss sprite */}
          <div
            className="mb-2 inline-block transition-all duration-300"
            style={{
              fontSize: "5rem",
              lineHeight: 1,
              filter: bossShake
                ? "brightness(2) drop-shadow(0 0 16px rgba(255,230,50,0.9))"
                : "drop-shadow(0 4px 12px rgba(0,0,0,0.5))",
            }}
          >
            {boss.emoji}
          </div>

          <h3 className="text-xl font-extrabold tracking-wide drop-shadow">{boss.name}</h3>
          <p className="mt-0.5 text-xs italic opacity-75">&ldquo;{boss.taunt}&rdquo;</p>

          {/* HP bar */}
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs font-bold opacity-90">
              <span>HP</span>
              <span className={hpFlash ? "animate-hp-flash" : ""}>{hpPercent}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-black/40">
              <div
                className={`h-full rounded-full transition-all duration-700 ${hpColor}`}
                style={{ width: `${hpPercent}%` }}
              />
            </div>
          </div>

          {/* Hit segment dots */}
          <div className="mt-3 flex justify-center gap-2">
            {Array.from({ length: totalHits }).map((_, i) => (
              <div
                key={i}
                className={`h-2 w-8 rounded-full transition-all duration-500 ${
                  i < hitsLanded ? "bg-white/25" : "bg-white/85 shadow-sm"
                }`}
              />
            ))}
          </div>
          <p className="mt-1.5 text-xs font-semibold opacity-75">
            Hit {Math.min(hitsLanded + 1, totalHits)} of {totalHits}
          </p>
        </div>
      </div>

      {/* Question + answers */}
      <div className={playerShake ? "animate-player-shake" : ""}>
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
