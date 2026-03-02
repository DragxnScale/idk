"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

interface DebugLine {
  time: string;
  msg: string;
}

function ts() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [debug, setDebug] = useState<DebugLine[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  function log(msg: string) {
    setDebug((prev) => [...prev, { time: ts(), msg }]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setDebug([]);
    setShowDebug(true);

    try {
      log("Starting signIn(credentials, redirect:false)…");

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      log(`signIn result: ok=${result?.ok} status=${result?.status} error=${result?.error ?? "none"} url=${result?.url ?? "none"}`);

      if (!result?.ok || result?.error) {
        log("FAILED — signIn returned error or not ok");
        throw new Error("Invalid email or password");
      }

      log("signIn succeeded. Checking cookies…");
      const allCookies = document.cookie;
      const cookieNames = allCookies
        ? allCookies.split(";").map((c) => c.trim().split("=")[0])
        : [];
      log(`Browser cookies (${cookieNames.length}): ${cookieNames.join(", ") || "(none visible to JS)"}`);

      log("Waiting 300ms for cookie to persist…");
      await new Promise((r) => setTimeout(r, 300));

      log("Calling /api/auth/debug to verify server-side session…");
      try {
        const dbg = await fetch("/api/auth/debug");
        const data = await dbg.json();
        log(`Debug response: ${JSON.stringify(data)}`);
      } catch (dbgErr) {
        log(`Debug fetch failed: ${dbgErr}`);
      }

      log("Calling /api/study/stats to check auth (5s timeout)…");
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const statsRes = await fetch("/api/study/stats", { signal: ctrl.signal });
        clearTimeout(timer);
        log(`Stats response: status=${statsRes.status} ok=${statsRes.ok}`);
        if (!statsRes.ok) {
          const body = await statsRes.text();
          log(`Stats error body: ${body.slice(0, 500)}`);
        } else {
          log("Stats OK — auth is fully working!");
        }
      } catch (statsErr) {
        log(`Stats check failed/timed out: ${statsErr}`);
      }

      log("Navigating to /dashboard…");
      window.location.href = "/dashboard";
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      log(`CATCH: ${msg}`);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-6 py-10 dark:bg-gray-950">
      <div className="w-full max-w-sm">
        <Link href="/" className="text-lg font-bold tracking-tight mb-8 block text-center">
          Study Focus
        </Link>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h1 className="text-xl font-bold mb-1">Welcome back</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Sign in to your account
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm transition focus:border-black focus:ring-1 focus:ring-black dark:border-gray-600 dark:bg-gray-800 dark:focus:border-white dark:focus:ring-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm transition focus:border-black focus:ring-1 focus:ring-black dark:border-gray-600 dark:bg-gray-800 dark:focus:border-white dark:focus:ring-white"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-gray-200"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="spinner h-4 w-4" />
                  Signing in…
                </span>
              ) : (
                "Sign in"
              )}
            </button>
          </form>
        </div>

        {/* Debug panel */}
        {showDebug && debug.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-amber-800 dark:text-amber-300">Debug Log</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(debug.map((d) => `${d.time}: ${d.msg}`).join("\n"));
                }}
                className="text-xs text-amber-700 underline dark:text-amber-400"
              >
                Copy
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-0.5">
              {debug.map((d, i) => (
                <p key={i} className="text-xs font-mono text-amber-900 dark:text-amber-200 break-all">
                  <span className="text-amber-600 dark:text-amber-500">{d.time}</span>{" "}
                  {d.msg}
                </p>
              ))}
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          Don&apos;t have an account?{" "}
          <Link href="/auth/signup" className="font-medium underline underline-offset-4">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
