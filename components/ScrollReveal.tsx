"use client";

import { useRef, useState, useEffect, useLayoutEffect, type ReactNode } from "react";

interface ScrollRevealProps {
  children: ReactNode;
  /** Extra Tailwind classes applied to the wrapper (e.g. margins). */
  className?: string;
}

function calcP(el: HTMLElement, buf = 100) {
  const { top, bottom } = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const enterP = Math.min(1, Math.max(0, (vh - buf - top) / buf));
  const exitP  = Math.min(1, Math.max(0, (bottom - buf) / buf));
  return Math.min(enterP, exitP);
}

/**
 * Scroll-position-driven reveal for app pages.
 * Fades + slides in as the element enters the viewport at a speed that
 * matches scroll velocity (same technique as landing page feature cards).
 * Once fully in view the element locks visible and the listener is removed,
 * so content never disappears on scroll-back.
 */
export function ScrollReveal({ children, className = "" }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  // Set initial progress before first paint to avoid a flash of invisible
  // content for elements that are already in the viewport on page load.
  useLayoutEffect(() => {
    if (ref.current) setProgress(calcP(ref.current));
  }, []);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (ref.current) setProgress(calcP(ref.current));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: progress,
        transform: `translateY(${(1 - progress) * 18}px)`,
        willChange: "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}
