"use client";

import { useCallback, useEffect, useState } from "react";

interface FullscreenTriggerProps {
  className?: string;
}

export function FullscreenTrigger({ className }: FullscreenTriggerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Fullscreen not supported or denied — ignore
    }
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      className={className}
      title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
    >
      {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
    </button>
  );
}
