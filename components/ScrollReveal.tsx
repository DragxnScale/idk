"use client";

import { useRef, useState, useEffect, useLayoutEffect, type ReactNode } from "react";
import { useUiEdit } from "@/components/ui-edit/UiEditContext";

interface ScrollRevealProps {
  children: ReactNode;
  /** Extra Tailwind classes applied to the wrapper (e.g. margins). */
  className?: string;
}

function calcP(el: HTMLElement, buf = 100) {
  const { top, bottom } = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const enterP = Math.min(1, Math.max(0, (vh - buf - top) / buf));
  const exitP = Math.min(1, Math.max(0, (bottom - buf) / buf));
  return Math.min(enterP, exitP);
}

function findScrollableParents(el: HTMLElement): (HTMLElement | Window)[] {
  const roots: (HTMLElement | Window)[] = [window];
  let node = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
      roots.push(node);
    }
    node = node.parentElement;
  }
  return roots;
}

/**
 * Scroll-position-driven reveal for app pages.
 * Fades + slides in as the element enters the viewport at a speed that
 * matches scroll velocity (same technique as landing page feature cards).
 * Disabled in admin UI edit mode so nested scroll containers show all copy.
 */
export function ScrollReveal({ children, className = "" }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const uiEdit = useUiEdit();
  const isEditMode = uiEdit?.editMode ?? false;
  const [progress, setProgress] = useState(isEditMode ? 1 : 0);

  const updateProgress = () => {
    if (ref.current) setProgress(calcP(ref.current));
  };

  useLayoutEffect(() => {
    if (isEditMode) {
      setProgress(1);
      return;
    }
    updateProgress();
  }, [isEditMode]);

  useEffect(() => {
    if (isEditMode) return;

    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateProgress);
    };

    const el = ref.current;
    if (!el) return;

    const roots = findScrollableParents(el);
    for (const root of roots) {
      root.addEventListener("scroll", onScroll, { passive: true });
    }

    return () => {
      for (const root of roots) {
        root.removeEventListener("scroll", onScroll);
      }
      cancelAnimationFrame(raf);
    };
  }, [isEditMode]);

  if (isEditMode) {
    return <div className={className}>{children}</div>;
  }

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
