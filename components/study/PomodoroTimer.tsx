"use client";

import { useEffect, useRef, useState } from "react";

interface PomodoroTimerProps {
  focusMin?: number;
  breakMin?: number;
  longBreakMin?: number;
  cyclesBeforeLong?: number;
  isPaused?: boolean;
  onPhaseChange?: (phase: "focus" | "break" | "longBreak") => void;
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

type Phase = "focus" | "break" | "longBreak";

export function PomodoroTimer({
  focusMin = 25,
  breakMin = 5,
  longBreakMin = 15,
  cyclesBeforeLong = 4,
  isPaused = false,
  onPhaseChange,
}: PomodoroTimerProps) {
  const [phase, setPhase] = useState<Phase>("focus");
  const [cycleCount, setCycleCount] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(focusMin * 60);
  const [totalPomodoros, setTotalPomodoros] = useState(0);
  const onPhaseChangeRef = useRef(onPhaseChange);
  useEffect(() => { onPhaseChangeRef.current = onPhaseChange; }, [onPhaseChange]);

  const phaseDuration = (p: Phase) => {
    if (p === "focus") return focusMin * 60;
    if (p === "longBreak") return longBreakMin * 60;
    return breakMin * 60;
  };

  useEffect(() => {
    if (isPaused) return;
    const id = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          // Advance phase
          setPhase((currentPhase) => {
            let next: Phase;
            let newCycles = cycleCount;
            if (currentPhase === "focus") {
              const newTotal = totalPomodoros + 1;
              setTotalPomodoros(newTotal);
              newCycles = cycleCount + 1;
              setCycleCount(newCycles);
              next = newCycles >= cyclesBeforeLong ? "longBreak" : "break";
              if (next === "longBreak") setCycleCount(0);
            } else {
              next = "focus";
            }
            onPhaseChangeRef.current?.(next);
            setTimeout(() => setSecondsLeft(phaseDuration(next)), 0);
            return next;
          });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaused, cycleCount, totalPomodoros, cyclesBeforeLong, focusMin, breakMin, longBreakMin]);

  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  const total = phaseDuration(phase);
  const progress = total > 0 ? 1 - secondsLeft / total : 0;

  const phaseLabel = phase === "focus" ? "Focus" : phase === "longBreak" ? "Long break" : "Short break";
  const ringColor = phase === "focus" ? "text-blue-500" : phase === "longBreak" ? "text-purple-500" : "text-green-500";
  const bgColor = phase === "focus" ? "bg-blue-50 dark:bg-blue-950/30" : phase === "longBreak" ? "bg-purple-50 dark:bg-purple-950/30" : "bg-green-50 dark:bg-green-950/30";

  const circumference = 2 * Math.PI * 28;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <div className={`rounded-xl p-4 ${bgColor} flex flex-col items-center gap-2`}>
      <div className="relative w-20 h-20">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="4" className="text-gray-200 dark:text-gray-700" />
          <circle
            cx="32" cy="32" r="28" fill="none" strokeWidth="4"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className={`${ringColor} transition-all duration-1000`}
            stroke="currentColor"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-mono font-semibold tabular-nums">{pad(m)}:{pad(s)}</span>
        </div>
      </div>
      <p className={`text-xs font-semibold uppercase tracking-wide ${ringColor}`}>{phaseLabel}</p>
      <p className="text-xs text-gray-400 dark:text-gray-500">
      {totalPomodoros} focus interval{totalPomodoros !== 1 ? "s" : ""} completed
      </p>
    </div>
  );
}
