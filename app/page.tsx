"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";

export default function HomePage() {
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isIos, setIsIos] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as any).standalone === true;
    setIsStandalone(standalone);

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIos(ios);

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
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

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Nav */}
      <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <img src="/favicon.png" alt="" className="w-7 h-7 rounded-md" />
            Bowl Beacon
          </Link>
          <nav className="flex items-center gap-3">
            {!isStandalone && (
              <button
                onClick={handleInstall}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 flex items-center gap-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download App
              </button>
            )}
            <Link
              href="/auth/signin"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Sign in
            </Link>
            <Link
              href="/auth/signup"
              className="btn-primary rounded-lg px-4 py-1.5 text-sm font-medium"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-20 md:py-28">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            Study smarter,
            <br />
            stay focused.
          </h1>
          <p className="mt-5 text-lg text-gray-600 leading-relaxed dark:text-gray-400">
            Upload a PDF or pick a textbook, set your timer, and start reading.
            Bowl Beacon keeps you on track with focus enforcement, AI-generated
            notes, end-of-session quizzes, and personalized review material.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/auth/signup"
              className="btn-primary rounded-lg px-6 py-3 text-sm font-medium shadow-sm transition"
            >
              Start studying free
            </Link>
            <Link
              href="/dashboard"
              className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-medium transition hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
            >
              View dashboard
            </Link>
            {canInstall && (
              <button
                onClick={handleInstall}
                className="rounded-lg border border-gray-300 px-6 py-3 text-sm font-medium transition hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800 flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download App
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="border-t border-gray-200 bg-white py-16 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-2xl font-bold mb-10 text-center">
            Everything you need to study effectively
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon="📖"
              title="In-app reading"
              description="Upload PDFs or browse our textbook catalog. Read right inside the app with a page-by-page viewer."
            />
            <FeatureCard
              icon="🎯"
              title="Focus enforcement"
              description="Timer pauses when you leave the tab. Fullscreen mode for distraction-free studying."
            />
            <FeatureCard
              icon="🤖"
              title="AI-powered notes"
              description="Generate study notes from the pages you read. Key concepts highlighted and organized automatically."
            />
            <FeatureCard
              icon="📝"
              title="Quizzes"
              description="End every session with an auto-generated quiz to test your understanding of the material."
            />
            <FeatureCard
              icon="📊"
              title="Progress tracking"
              description="Track your study time, sessions, and streaks. See your weekly activity at a glance."
            />
            <FeatureCard
              icon="🎬"
              title="Review & videos"
              description="Get personalized review material and curated video suggestions to reinforce your learning."
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-6">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="text-2xl font-bold mb-4">Ready to study?</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Create a free account and start your first session in under a minute.
          </p>
          <Link
            href="/auth/signup"
            className="btn-primary inline-block rounded-lg px-8 py-3 text-sm font-medium shadow-sm"
          >
            Get started
          </Link>
        </div>
      </section>

      {/* Install guide modal */}
      {showIosGuide && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowIosGuide(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-2xl mb-4 sm:mb-0" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold mb-3">Install Bowl Beacon</h3>
            {isIos ? (
              <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                <p className="flex items-center gap-2">
                  <span className="font-mono bg-gray-100 dark:bg-gray-800 rounded px-2 py-0.5 text-xs">1</span>
                  Open this page in <strong className="text-gray-900 dark:text-white">Safari</strong>
                </p>
                <p className="flex items-center gap-2">
                  <span className="font-mono bg-gray-100 dark:bg-gray-800 rounded px-2 py-0.5 text-xs">2</span>
                  Tap the <strong className="text-gray-900 dark:text-white">Share</strong> button
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                </p>
                <p className="flex items-center gap-2">
                  <span className="font-mono bg-gray-100 dark:bg-gray-800 rounded px-2 py-0.5 text-xs">3</span>
                  Tap <strong className="text-gray-900 dark:text-white">Add to Home Screen</strong>
                </p>
              </div>
            ) : (
              <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                <p className="flex items-center gap-2">
                  <span className="font-mono bg-gray-100 dark:bg-gray-800 rounded px-2 py-0.5 text-xs">1</span>
                  Open this page in <strong className="text-gray-900 dark:text-white">Chrome</strong> or <strong className="text-gray-900 dark:text-white">Edge</strong>
                </p>
                <p className="flex items-center gap-2">
                  <span className="font-mono bg-gray-100 dark:bg-gray-800 rounded px-2 py-0.5 text-xs">2</span>
                  Tap the <strong className="text-gray-900 dark:text-white">menu</strong> (three dots)
                </p>
                <p className="flex items-center gap-2">
                  <span className="font-mono bg-gray-100 dark:bg-gray-800 rounded px-2 py-0.5 text-xs">3</span>
                  Tap <strong className="text-gray-900 dark:text-white">Install app</strong> or <strong className="text-gray-900 dark:text-white">Add to Home Screen</strong>
                </p>
              </div>
            )}
            <button onClick={() => setShowIosGuide(false)} className="mt-5 w-full btn-primary rounded-lg py-2.5 text-sm font-medium">
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-gray-200 py-8 dark:border-gray-800">
        <div className="mx-auto max-w-5xl px-6 flex flex-wrap items-center justify-between gap-4 text-xs text-gray-500 dark:text-gray-400">
          <p>Bowl Beacon</p>
          <div className="flex gap-4">
            <Link href="/dashboard" className="hover:underline">
              Dashboard
            </Link>
            <Link href="/study/session" className="hover:underline">
              Study
            </Link>
            <Link href="/study/history" className="hover:underline">
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
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-800">
      <span className="text-2xl">{icon}</span>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm text-gray-600 leading-relaxed dark:text-gray-400">
        {description}
      </p>
    </div>
  );
}
