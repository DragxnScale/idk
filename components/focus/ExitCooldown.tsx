"use client";

import { useEffect, useState } from "react";
import { SuiText } from "@/components/ui-copy/UiCopyProvider";

interface ExitCooldownProps {
  seconds: number;
  onDone: () => void;
  onCancel: () => void;
}

export function ExitCooldown({ seconds, onDone, onCancel }: ExitCooldownProps) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    setRemaining(seconds);
  }, [seconds]);

  useEffect(() => {
    if (remaining <= 0) {
      onDone();
      return;
    }
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, onDone]);

  const pct = ((seconds - remaining) / seconds) * 100;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        <SuiText page="exit-boss" k="cooldown.text" def="Exit runway charging… take a breath before you go." as="span" />
      </p>
      <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-amber-500 transition-all duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-center text-3xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
        {remaining}s
      </p>
      <button
        type="button"
        onClick={onCancel}
        className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600"
      >
        <SuiText page="exit-boss" k="btn.keep-studying" def="Keep studying" as="span" />
      </button>
    </div>
  );
}
