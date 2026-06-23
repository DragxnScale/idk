"use client";

import { useRef, useState, useEffect, ReactNode } from "react";

interface ScrollRevealProps {
  children: ReactNode;
  /** Extra Tailwind classes applied to the wrapper (e.g. margins). */
  className?: string;
  /** Optional delay in ms — use to stagger sibling reveals. */
  delay?: number;
}

/**
 * One-way scroll reveal: fades + slides a child into view the first time
 * it enters the viewport, then stays visible. Suitable for app pages where
 * content should appear progressively but not disappear on scroll-back.
 */
export function ScrollReveal({ children, className = "", delay = 0 }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.05, rootMargin: "0px 0px -40px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(18px)",
        transition: `opacity 0.5s ease ${delay}ms, transform 0.5s ease ${delay}ms`,
        willChange: "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}
