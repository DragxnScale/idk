"use client";

import { useEffect, useRef } from "react";
import type { UiCopyElement } from "@/lib/ui-copy-shared";

type TextEditPanelProps = {
  compoundKey: string;
  element: UiCopyElement;
  defaultText: string;
  anchor: { x: number; y: number };
  onChange: (patch: Partial<UiCopyElement>) => void;
  onRequestConfirm: () => void;
  onClose: () => void;
  onUndo: () => void;
};

export function TextEditPanel({
  compoundKey,
  element,
  defaultText,
  anchor,
  onChange,
  onRequestConfirm,
  onClose,
  onUndo,
}: TextEditPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const text = element.text ?? defaultText;
  const formFont = element.fontFamily ?? "";
  const formSize = element.fontSize?.replace("px", "") ?? "";
  const formColor = element.color ?? "#e2e8f0";
  const formBold = element.fontWeight === "700" || element.fontWeight === "bold";
  const formUnderline = element.textDecoration === "underline";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(anchor.x, window.innerWidth - 420),
    top: Math.min(anchor.y, window.innerHeight - 480),
    zIndex: 90,
  };

  return (
    <div
      ref={panelRef}
      style={style}
      className="w-full max-w-md rounded-2xl border border-slate-600 bg-slate-900 p-5 shadow-2xl"
    >
      <div className="flex justify-between items-start mb-3">
        <h4 className="text-sm font-semibold text-white">Edit: {compoundKey}</h4>
        <button
          type="button"
          className="text-slate-400 hover:text-white text-lg leading-none"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="text-slate-400 text-xs">Text</span>
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white"
            rows={3}
            value={text}
            onChange={(e) => onChange({ text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onRequestConfirm();
              }
            }}
          />
        </label>
        <label className="block">
          <span className="text-slate-400 text-xs">Font</span>
          <select
            className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white"
            value={formFont || "inherit"}
            onChange={(e) =>
              onChange({ fontFamily: e.target.value === "inherit" ? undefined : e.target.value })
            }
          >
            <option value="inherit">Default</option>
            <option value="system-ui, sans-serif">System UI</option>
            <option value="Georgia, serif">Georgia</option>
            <option value="ui-serif, serif">Serif</option>
            <option value="Arial, Helvetica, sans-serif">Arial</option>
            <option value="'Times New Roman', Times, serif">Times New Roman</option>
          </select>
        </label>
        <label className="block">
          <span className="text-slate-400 text-xs">Size (px)</span>
          <input
            type="number"
            min={10}
            max={48}
            className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white"
            value={formSize}
            onChange={(e) => {
              const v = e.target.value;
              onChange({ fontSize: v ? `${v}px` : undefined });
            }}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-400 text-xs">Color</span>
          <input
            type="color"
            className="h-8 w-14 cursor-pointer rounded border border-slate-600 bg-transparent"
            value={formColor.startsWith("#") ? formColor : "#e2e8f0"}
            onChange={(e) => onChange({ color: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={formBold}
            onChange={(e) => onChange({ fontWeight: e.target.checked ? "700" : undefined })}
          />
          <span className="text-slate-300">Bold</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={formUnderline}
            onChange={(e) => onChange({ textDecoration: e.target.checked ? "underline" : undefined })}
          />
          <span className="text-slate-300">Underline</span>
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onUndo}
          className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={onRequestConfirm}
          className="ml-auto rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
        >
          Save (Enter)
        </button>
      </div>
    </div>
  );
}
