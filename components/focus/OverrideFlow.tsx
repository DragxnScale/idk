"use client";

import { useState } from "react";

interface OverrideFlowProps {
  onConfirmEnd: () => void;
}

export function OverrideFlow({ onConfirmEnd }: OverrideFlowProps) {
  const [showBar, setShowBar] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setShowBar(true)}
        className="rounded border border-red-500/40 px-3 py-1.5 text-sm text-red-600 dark:text-red-400"
      >
        I need to stop
      </button>

      {showBar && (
        <div className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 bg-white px-4 py-3 shadow-lg dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm font-medium">
            Are you sure you want to end this session? Progress will be saved.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowBar(false)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setShowBar(false);
                onConfirmEnd();
              }}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white"
            >
              End session
            </button>
          </div>
        </div>
      )}
    </>
  );
}
