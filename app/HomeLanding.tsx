"use client";

import Link from "next/link";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { SuiText } from "@/components/ui-copy/UiCopyProvider";
import { SuiImage } from "@/components/ui-copy/SuiImage";
import BookFlipCanvas from "@/components/landing/BookFlipCanvas";

/**
 * Marketing landing page for unauthenticated visitors. The server-side
 * `app/page.tsx` shell renders this only when no session cookie is
 * present; signed-in users get redirected to `/dashboard` before this
 * component is reached.
 */

/** One-shot: fires once then disconnects (used for hero sections). */
function useInView(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

/**
 * Scroll-position-driven reveal — returns a 0→1 progress value that
 * tracks how far the element is inside the viewport transition zone.
 * Because it's driven by scroll position (not a CSS transition), the
 * animation speed naturally matches scroll speed.
 */
function calcProgress(el: HTMLElement, buf = 120) {
  const { top, bottom } = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const enterP = Math.min(1, Math.max(0, (vh - buf - top) / buf));
  const exitP  = Math.min(1, Math.max(0, (bottom - buf) / buf));
  return Math.min(enterP, exitP);
}

function useScrollReveal(buf = 120) {
  const ref = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  // Run before first paint so elements already in view start visible (no flash).
  useLayoutEffect(() => {
    if (ref.current) setProgress(calcProgress(ref.current, buf));
  }, [buf]);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (ref.current) setProgress(calcProgress(ref.current, buf));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [buf]);

  return [ref, progress] as const;
}

export default function HomeLanding() {
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isIos, setIsIos] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true;
    setIsStandalone(standalone);

    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as any).MSStream;
    setIsIos(ios);

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  async function handleInstall() {
    if (installPrompt) {
      installPrompt.prompt();
      const result = await installPrompt.userChoice;
      if (result.outcome === "accepted") setInstallPrompt(null);
    } else {
      setShowIosGuide(true);
    }
  }

  const canInstall = !isStandalone && (!!installPrompt || isIos);

  // Scroll-driven text reveals
  const [heroH1Ref,  heroH1P]  = useScrollReveal(80);
  const [heroPRef,   heroPP]   = useScrollReveal(80);
  const [heroCtaRef, heroCtaP] = useScrollReveal(80);
  const [featHeadRef, featHeadP] = useScrollReveal();
  const [ctaRef, ctaP] = useScrollReveal();

  // --theme-primary / --theme-accent → royal blue (#0000ff) — buttons, text
  // --landing-purple                → royal purple (#8d00ff) — orbital rings, secondary glows
  const landingTheme = {
    "--theme-primary":    "#0000ff",
    "--theme-primary-fg": "#ffffff",
    "--theme-accent":     "#0000ff",
    "--landing-purple":   "#8d00ff",
  } as React.CSSProperties;

  return (
    <main
      className="relative min-h-screen bg-black text-white overflow-x-hidden"
      style={landingTheme}
    >
      {/* ── ambient background glows ── */}
      <div className="fixed inset-0 pointer-events-none z-0" aria-hidden>
        <div className="absolute -top-48 -left-48 w-[600px] h-[600px] rounded-full blur-[160px]" style={{ background: "color-mix(in srgb, var(--theme-accent) 12%, transparent)" }} />
        <div className="absolute top-1/3 -right-48 w-[500px] h-[500px] rounded-full blur-[160px]" style={{ background: "color-mix(in srgb, var(--landing-purple) 12%, transparent)" }} />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] rounded-full blur-[130px]" style={{ background: "color-mix(in srgb, var(--theme-accent) 8%, transparent)" }} />
      </div>


      {/* ── nav ── */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-black/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-bold tracking-tight"
          >
            <SuiImage
              page="home"
              k="nav.favicon"
              defSrc="/favicon.png"
              alt=""
              className="w-7 h-7 rounded-md"
            />
            <SuiText page="home" k="nav.brand" def="Bowl Beacon" as="span" />
          </Link>

          <nav className="flex items-center gap-2">
            {!isStandalone && (
              <button
                onClick={handleInstall}
                className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-medium text-white/80 backdrop-blur-sm transition hover:bg-white/10 hover:text-white active:scale-95"
              >
                <DownloadIcon />
                <span className="hidden sm:inline">
                  <SuiText
                    page="home"
                    k="nav.download"
                    def="Download App"
                    as="span"
                  />
                </span>
              </button>
            )}
            <Link
              href="/auth/signin"
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-medium text-white/80 backdrop-blur-sm transition hover:bg-white/10 hover:text-white active:scale-95"
            >
              <SuiText page="home" k="nav.signin" def="Sign in" as="span" />
            </Link>
            <Link
              href="/auth/signup"
              className="btn-primary btn-primary-glow rounded-lg px-4 py-1.5 text-sm font-semibold transition"
            >
              <SuiText
                page="home"
                k="nav.getstarted"
                def="Get started"
                as="span"
              />
            </Link>
          </nav>
        </div>
      </header>

      {/* ── hero ── */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-20 lg:py-28">
        <div className="grid lg:grid-cols-[minmax(0,28rem)_1fr] items-center gap-10 lg:gap-16">
          <div className="relative z-10 min-w-0">
            <div
              ref={heroH1Ref}
              style={{ opacity: heroH1P, transform: `translateY(${(1 - heroH1P) * 24}px)`, willChange: "opacity, transform" }}
            >
              <h1 className="text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl leading-tight">
                <SuiText
                  page="home"
                  k="hero.line1"
                  def="Study smarter,"
                  as="span"
                />
                <br />
                <span className="text-accent">
                  <SuiText
                    page="home"
                    k="hero.line2"
                    def="stay focused."
                    as="span"
                  />
                </span>
              </h1>
            </div>

            <div
              ref={heroPRef}
              style={{ opacity: heroPP, transform: `translateY(${(1 - heroPP) * 28}px)`, willChange: "opacity, transform" }}
            >
              <p className="mt-5 text-lg text-white/55 leading-relaxed">
                <SuiText
                  page="home"
                  k="hero.body"
                  def="Upload a PDF or pick a textbook, set your timer, and start reading. Bowl Beacon keeps you on track with focus enforcement, AI-generated notes, end-of-session quizzes, and personalized review material."
                  as="span"
                />
              </p>
            </div>

            <div
              ref={heroCtaRef}
              className="mt-8 flex flex-wrap items-center gap-4"
              style={{ opacity: heroCtaP, transform: `translateY(${(1 - heroCtaP) * 32}px)`, willChange: "opacity, transform" }}
            >
              <Link
                href="/auth/signup"
                className="btn-primary btn-primary-glow relative z-0 rounded-lg px-6 py-3 text-sm font-semibold transition"
              >
                <SuiText
                  page="home"
                  k="hero.cta1"
                  def="Start studying free"
                  as="span"
                />
              </Link>
              <Link
                href="/dashboard"
                className="relative z-10 rounded-lg border border-white/20 bg-zinc-950 px-6 py-3 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:bg-zinc-900 hover:border-white/35 active:scale-95"
              >
                <SuiText
                  page="home"
                  k="hero.cta2"
                  def="View dashboard"
                  as="span"
                />
              </Link>
              {canInstall && (
                <button
                  onClick={handleInstall}
                  className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-6 py-3 text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/10 hover:border-white/35 active:scale-95"
                >
                  <DownloadIcon size={16} />
                  <SuiText
                    page="home"
                    k="hero.cta3"
                    def="Download App"
                    as="span"
                  />
                </button>
              )}
            </div>
          </div>

          {/* hero visual — sits in the page's fixed purple/blue glow (no extra local halo) */}
          <div className="hidden lg:flex justify-end items-center min-w-0 translate-y-2">
            <div
              className="relative shrink-0 select-none"
              style={{ width: 572, height: 429 }}
              aria-hidden
            >
              <BookFlipCanvas scale={1.3} />
            </div>
          </div>
        </div>
      </section>

      {/* ── feature grid ── */}
      <section className="relative z-10 border-t border-white/10 py-20">
        <div className="mx-auto max-w-5xl px-6">
          <h2
            ref={featHeadRef}
            className="text-2xl font-bold mb-12 text-center"
            style={{ opacity: featHeadP, transform: `translateY(${(1 - featHeadP) * 24}px)`, willChange: "opacity, transform" }}
          >
            <SuiText
              page="home"
              k="features.title"
              def="Everything you need to study effectively"
              as="span"
            />
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard accent="blue"   icon="📖" titleKey="features.f1.title" descKey="features.f1.desc" title="In-app reading" description="Upload PDFs or browse our textbook catalog. Read right inside the app with a page-by-page viewer." />
            <FeatureCard accent="purple" icon="🎯" titleKey="features.f2.title" descKey="features.f2.desc" title="Focus enforcement" description="Timer pauses when you leave the tab. Fullscreen mode for distraction-free studying." />
            <FeatureCard accent="blue"   icon="🤖" titleKey="features.f3.title" descKey="features.f3.desc" title="AI-powered notes" description="Generate study notes from the pages you read. Key concepts highlighted and organized automatically." />
            <FeatureCard accent="purple" icon="📝" titleKey="features.f4.title" descKey="features.f4.desc" title="Quizzes" description="End every session with an auto-generated quiz to test your understanding of the material." />
            <FeatureCard accent="blue"   icon="📊" titleKey="features.f5.title" descKey="features.f5.desc" title="Progress tracking" description="Track your study time, sessions, and streaks. See your weekly activity at a glance." />
            <FeatureCard accent="purple" icon="🎬" titleKey="features.f6.title" descKey="features.f6.desc" title="Review & videos" description="Get personalized review material and curated video suggestions to reinforce your learning." />
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative z-10 py-20 px-6">
        <div
          ref={ctaRef}
          className="mx-auto max-w-xl text-center"
          style={{ opacity: ctaP, transform: `translateY(${(1 - ctaP) * 32}px)`, willChange: "opacity, transform" }}
        >
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-10 backdrop-blur-sm cta-card-glow">
            <h2 className="text-2xl font-bold mb-4">
              <SuiText page="home" k="cta.title" def="Ready to study?" as="span" />
            </h2>
            <p className="text-white/55 mb-8">
              <SuiText
                page="home"
                k="cta.body"
                def="Create a free account and start your first session in under a minute."
                as="span"
              />
            </p>
            <Link
              href="/auth/signup"
              className="btn-primary btn-primary-glow inline-block rounded-lg px-10 py-3 text-sm font-semibold transition"
            >
              <SuiText page="home" k="cta.button" def="Get started" as="span" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── iOS install modal ── */}
      {showIosGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setShowIosGuide(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-black/90 backdrop-blur-md p-6 shadow-2xl mb-4 sm:mb-0"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-4">
              <SuiText
                page="home"
                k="install.title"
                def="Install Bowl Beacon"
                as="span"
              />
            </h3>
            {isIos ? (
              <div className="space-y-3 text-sm text-white/60">
                <p className="flex items-center gap-2">
                  <StepBadge>1</StepBadge>
                  Open this page in <strong className="text-white">Safari</strong>
                </p>
                <p className="flex items-center gap-2">
                  <StepBadge>2</StepBadge>
                  Tap the <strong className="text-white">Share</strong> button
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                </p>
                <p className="flex items-center gap-2">
                  <StepBadge>3</StepBadge>
                  Tap <strong className="text-white">Add to Home Screen</strong>
                </p>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-white/60">
                <p className="flex items-center gap-2">
                  <StepBadge>1</StepBadge>
                  Open in <strong className="text-white">Chrome</strong> or <strong className="text-white">Edge</strong>
                </p>
                <p className="flex items-center gap-2">
                  <StepBadge>2</StepBadge>
                  Tap the <strong className="text-white">menu</strong> (⋮)
                </p>
                <p className="flex items-center gap-2">
                  <StepBadge>3</StepBadge>
                  Tap <strong className="text-white">Add to Home Screen</strong>
                </p>
              </div>
            )}
            <button
              onClick={() => setShowIosGuide(false)}
              className="btn-primary btn-primary-glow mt-6 w-full rounded-lg py-2.5 text-sm font-semibold transition"
            >
              <SuiText page="home" k="install.gotit" def="Got it" as="span" />
            </button>
          </div>
        </div>
      )}

      {/* ── footer ── */}
      <footer className="relative z-10 border-t border-white/10 py-8">
        <div className="mx-auto max-w-5xl px-6 flex flex-wrap items-center justify-between gap-4 text-xs text-white/35">
          <p>
            <SuiText page="home" k="footer.brand" def="Bowl Beacon" as="span" />
          </p>
          <div className="flex gap-5">
            <Link href="/dashboard" className="transition hover:text-white">
              Dashboard
            </Link>
            <Link href="/study/session" className="transition hover:text-white">
              Study
            </Link>
            <Link href="/study/history" className="transition hover:text-white">
              History
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  titleKey,
  descKey,
  accent = "blue",
}: {
  icon: string;
  title: string;
  description: string;
  titleKey: string;
  descKey: string;
  accent?: "blue" | "purple";
}) {
  const [scrollRef, progress] = useScrollReveal();
  const color = accent === "purple" ? "var(--landing-purple)" : "var(--theme-accent)";

  return (
    // Outer wrapper carries scroll-driven opacity + translateY (no CSS transition
    // so the animation speed matches scroll speed exactly).
    <div
      ref={scrollRef}
      style={{
        opacity: progress,
        transform: `translateY(${(1 - progress) * 28}px)`,
        willChange: "opacity, transform",
      }}
    >
      {/* Inner card keeps hover effects independent of scroll animation */}
      <div
        className="rounded-xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm transition-[box-shadow,border-color,transform] duration-300"
        style={{ ["--card-accent" as string]: color }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLElement;
          el.style.borderColor = `color-mix(in srgb, ${color} 40%, transparent)`;
          el.style.boxShadow   = `0 0 32px color-mix(in srgb, ${color} 20%, transparent)`;
          el.style.transform   = "translateY(-4px)";
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLElement;
          el.style.borderColor = "";
          el.style.boxShadow   = "";
          el.style.transform   = "";
        }}
      >
        <div
          className="inline-flex w-11 h-11 items-center justify-center rounded-lg text-xl"
          style={{ background: `color-mix(in srgb, ${color} 15%, transparent)` }}
        >
          {icon}
        </div>
        <h3 className="mt-4 text-sm font-semibold text-white">
          <SuiText page="home" k={titleKey} def={title} as="span" />
        </h3>
        <p className="mt-1.5 text-sm text-white/50 leading-relaxed">
          <SuiText page="home" k={descKey} def={description} as="span" />
        </p>
      </div>
    </div>
  );
}

function StepBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 font-mono bg-white/10 rounded px-2 py-0.5 text-xs text-white/70">
      {children}
    </span>
  );
}

function DownloadIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
