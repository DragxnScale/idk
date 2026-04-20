"use client";

import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { SettingsUiElement } from "@/lib/settings-ui";

type Ctx = {
  elements: Record<string, SettingsUiElement>;
  loading: boolean;
};

const SettingsUiContext = createContext<Ctx | null>(null);

export function SettingsUiProvider({ children }: { children: ReactNode }) {
  const [elements, setElementsState] = useState<Record<string, SettingsUiElement>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/app/settings-ui")
      .then((r) => (r.ok ? r.json() : { elements: {} }))
      .then((d: { elements?: Record<string, SettingsUiElement> }) => setElementsState(d.elements ?? {}))
      .catch(() => setElementsState({}))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(() => ({ elements, loading }), [elements, loading]);

  return <SettingsUiContext.Provider value={value}>{children}</SettingsUiContext.Provider>;
}

export function useSettingsUi() {
  return useContext(SettingsUiContext);
}

function styleFromEl(el: SettingsUiElement | undefined): CSSProperties | undefined {
  if (!el) return undefined;
  const s: CSSProperties = {};
  if (el.fontFamily) s.fontFamily = el.fontFamily;
  if (el.fontSize) s.fontSize = el.fontSize;
  if (el.color) s.color = el.color;
  if (el.fontWeight) s.fontWeight = el.fontWeight as CSSProperties["fontWeight"];
  if (el.textDecoration === "underline") s.textDecoration = "underline";
  const keys = Object.keys(s);
  return keys.length ? s : undefined;
}

/** Applies admin-configured copy + inline typography for a Settings page string. */
export function SuiText({
  k,
  def,
  className,
  as: Tag = "span",
  children,
}: {
  k: string;
  def: string;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
  children?: ReactNode;
}) {
  const ctx = useSettingsUi();
  const el = ctx?.elements[k];
  const style = styleFromEl(el);
  const text = el?.text ?? def;
  return (
    <Tag className={className} style={style}>
      {text}
      {children}
    </Tag>
  );
}
