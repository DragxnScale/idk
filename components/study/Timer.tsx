"use client";

import { useEffect, useRef, useState } from "react";

export type GoalType = "time" | "chapter";

interface TimerProps {
  goalType: GoalType;
  /** Minutes for "time" goals, chapter number for "chapter" goals */
  targetValue: number;
  isPaused?: boolean;
  initialElapsedSeconds?: number;
  onTick?: (totalFocusedMinutes: number) => void;
  onGoalReached?: () => void;
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${pad(m)}:${pad(s)}`;
}

export function Timer({
  goalType,
  targetValue,
  isPaused = false,
  initialElapsedSeconds = 0,
  onTick,
  onGoalReached,
}: TimerProps) {
  const [elapsed, setElapsed] = useState(initialElapsedSeconds);

  const onTickRef = useRef(onTick);
  const onGoalReachedRef = useRef(onGoalReached);
  useEffect(() => { onTickRef.current = onTick; }, [onTick]);
  useEffect(() => { onGoalReachedRef.current = onGoalReached; }, [onGoalReached]);

  useEffect(() => {
    if (isPaused) return;

    const targetSec =
      goalType === "time" ? targetValue * 60 : Number.POSITIVE_INFINITY;

    const id = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        onTickRef.current?.(Math.floor(next / 60));
        if (goalType === "time" && prev < targetSec && next >= targetSec) {
          onGoalReachedRef.current?.();
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [isPaused, goalType, targetValue]);

  if (goalType === "chapter") {
    return (
      <div className="text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Chapter goal
        </p>
        <p className="text-3xl font-semibold">
          {targetValue} ch.
        </p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {formatTime(elapsed)} studied
        </p>
      </div>
    );
  }

  const targetSec = targetValue * 60;
  const remaining = Math.max(0, targetSec - elapsed);
  const done = elapsed >= targetSec;

  return (
    <div className="text-center">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {done ? "Goal reached!" : "Time remaining"}
      </p>
      <p className="text-4xl font-mono font-semibold tabular-nums">
        {done ? "00:00" : formatTime(remaining)}
      </p>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        Elapsed: {formatTime(elapsed)}
      </p>
    </div>
  );
}
