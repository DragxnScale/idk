"use client";

import { useEffect, useState } from "react";

export function ImpersonationBanner() {
  const [state, setState] = useState<{
    impersonating: boolean;
    adminEmail: string | null;
    viewingEmail: string | null;
  } | null>(null);

  useEffect(() => {
    fetch("/api/user/session-context")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.impersonating) {
          setState(null);
          return;
        }
        setState({
          impersonating: true,
          adminEmail: data.adminEmail ?? null,
          viewingEmail: data.effectiveUser?.email ?? null,
        });
      })
      .catch(() => setState(null));
  }, []);

  async function stopViewing() {
    await fetch("/api/admin/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: null }),
    });
    window.location.reload();
  }

  if (!state?.impersonating) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-[100] flex justify-center pointer-events-none px-3 pb-3">
      <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/50 bg-amber-950/95 px-4 py-2.5 text-sm text-amber-100 shadow-lg backdrop-blur-sm max-w-[min(100%,42rem)]">
        <span>
          Viewing as <strong className="font-semibold">{state.viewingEmail ?? "user"}</strong>
          {state.adminEmail ? (
            <span className="text-amber-200/80"> — signed in as {state.adminEmail}</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => void stopViewing()}
          className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500 transition"
        >
          Exit view as user
        </button>
      </div>
    </div>
  );
}
