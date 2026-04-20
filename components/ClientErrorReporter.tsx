"use client";

import { useEffect } from "react";

function report(payload: Record<string, unknown>) {
  const body = JSON.stringify({
    ...payload,
    url: typeof window !== "undefined" ? window.location.href : undefined,
    t: Date.now(),
  });
  try {
    void fetch("/api/debug/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {
    /* ignore */
  }
}

export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (ev: ErrorEvent) => {
      report({
        message: ev.message || "window.error",
        stack: ev.error?.stack ?? String(ev.error ?? ""),
        extra: { filename: ev.filename, lineno: ev.lineno, colno: ev.colno },
      });
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason;
      report({
        message:
          reason instanceof Error
            ? reason.message
            : typeof reason === "string"
              ? reason
              : "Unhandled rejection",
        stack: reason instanceof Error ? reason.stack : undefined,
        extra: { kind: "unhandledrejection" },
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
