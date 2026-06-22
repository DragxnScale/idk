"use client";

import { useEffect, useRef } from "react";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirming?: boolean;
};

export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  confirming = false,
}: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!confirming) onConfirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onConfirm, onCancel, confirming]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-600 bg-slate-900 p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <h2 id="confirm-title" className="text-lg font-semibold text-white mb-4">
          {title}
        </h2>
        <div className="mb-6 text-sm text-slate-300">{children}</div>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={confirming}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={confirming}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {confirming ? "Saving…" : confirmLabel}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500 text-center">
          Press Enter to confirm · Escape to cancel
        </p>
      </div>
    </div>
  );
}
