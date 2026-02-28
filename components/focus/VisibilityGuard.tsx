"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface VisibilityGuardProps {
  children: React.ReactNode;
  onTabReturn?: () => void;
  onResume?: () => void;
}

export function VisibilityGuard({
  children,
  onTabReturn,
  onResume,
}: VisibilityGuardProps) {
  const [showOverlay, setShowOverlay] = useState(false);
  const hadLeft = useRef(false);

  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === "hidden") {
      hadLeft.current = true;
    } else if (document.visibilityState === "visible" && hadLeft.current) {
      hadLeft.current = false;
      setShowOverlay(true);
      onTabReturn?.();
    }
  }, [onTabReturn]);

  useEffect(() => {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [handleVisibilityChange]);

  const handleResume = useCallback(() => {
    setShowOverlay(false);
    onResume?.();
  }, [onResume]);

  return (
    <>
      {children}

      {showOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900">
            <h2 className="text-lg font-semibold">You left the tab</h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Stay focused! Your timer was paused while you were away. Click
              Resume to keep going.
            </p>
            <button
              type="button"
              onClick={handleResume}
              className="mt-5 w-full rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-black"
            >
              Resume
            </button>
          </div>
        </div>
      )}
    </>
  );
}
