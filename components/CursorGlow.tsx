"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Global cursor-following radial glow overlay.
 * Rendered in the root layout and hidden on active study-session routes
 * where distraction-free focus is the priority.
 */
export function CursorGlow() {
  const pathname = usePathname();
  const [pos, setPos] = useState({ x: -999, y: -999 });

  const excluded = !!pathname?.startsWith("/study/session");

  useEffect(() => {
    if (excluded) return;
    const onMove = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [excluded]);

  if (excluded) return null;

  return (
    <div
      className="fixed inset-0 pointer-events-none z-[9998]"
      aria-hidden
      style={{
        background: `radial-gradient(160px circle at ${pos.x}px ${pos.y}px, color-mix(in srgb, var(--theme-accent) 25%, transparent), transparent 80%)`,
      }}
    />
  );
}
