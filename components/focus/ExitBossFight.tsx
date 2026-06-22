"use client";

import { useState } from "react";

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
  boss: BossFightData;
  bossIndex: number;
  totalBosses: number;
  onDefeated: () => void;
  onRequirePhrase: () => void;
  onCancel: () => void;
  sessionId: string;
}

export function ExitBossFight({
  boss,
  bossIndex,
  totalBosses,
  onDefeated,
  onRequirePhrase,
  onCancel,
  sessionId,
}: ExitBossFightProps) {
  const [hp, setHp] = useState(100);
  const [attempts, setAttempts] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [grading, setGrading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  async function attack(selectedIndex: number) {
    if (grading) return;
    setGrading(true);
    setSelected(selectedIndex);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/study/sessions/${sessionId}/exit-bosses/grade`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bossId: boss.bossId, selectedIndex }),
        }
      );
      const data = await res.json();
      if (data.correct) {
        setHp(0);
        setFeedback(data.explanation ? `Hit! ${data.explanation}` : "Direct hit! Boss defeated.");
        setTimeout(() => onDefeated(), 900);
      } else {
        const nextAttempts = attempts + 1;
        setAttempts(nextAttempts);
        setShake(true);
        setTimeout(() => setShake(false), 400);
        if (nextAttempts >= 2) {
          setFeedback("The boss shields the exit. Type the unlock phrase instead.");
          setTimeout(() => onRequirePhrase(), 1200);
        } else {
          setFeedback(
            data.explanation
              ? `Blocked! ${data.explanation} — try once more.`
              : "Blocked! Try once more."
          );
        }
      }
    } catch {
      setFeedback("Something went wrong. Try again.");
    } finally {
      setGrading(false);
      setSelected(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
        Boss {bossIndex + 1} of {totalBosses}
      </p>

      <div
        className={`rounded-xl bg-gradient-to-br ${boss.colorClass} p-4 text-white text-center transition-transform ${shake ? "animate-pulse scale-95" : ""}`}
      >
        <div className="text-4xl mb-1">{boss.emoji}</div>
        <h3 className="text-lg font-bold">{boss.name}</h3>
        <p className="text-sm opacity-90 mt-1 italic">&ldquo;{boss.taunt}&rdquo;</p>
        <div className="mt-3 h-2 rounded-full bg-black/30 overflow-hidden">
          <div
            className="h-full rounded-full bg-white/90 transition-all duration-500"
            style={{ width: `${hp}%` }}
          />
        </div>
      </div>

      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
        {boss.question}
      </p>

      <div className="grid gap-2">
        {boss.options.map((opt, i) => (
          <button
            key={i}
            type="button"
            disabled={grading || hp === 0}
            onClick={() => attack(i)}
            className={`rounded-lg border px-3 py-2.5 text-left text-sm transition ${
              selected === i
                ? "border-amber-500 bg-amber-50 dark:bg-amber-950/40"
                : "border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
            } disabled:opacity-50`}
          >
            <span className="font-mono text-xs text-gray-400 mr-2">
              {["A", "B", "C", "D"][i]}
            </span>
            {opt}
          </button>
        ))}
      </div>

      {feedback && (
        <p className={`text-xs ${hp === 0 ? "text-green-600 dark:text-green-400" : "text-amber-700 dark:text-amber-300"}`}>
          {feedback}
        </p>
      )}

      <button
        type="button"
        onClick={onCancel}
        className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600"
      >
        Keep studying
      </button>
    </div>
  );
}
