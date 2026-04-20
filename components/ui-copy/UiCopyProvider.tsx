"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { UiCopyElement, UiPageId } from "@/lib/ui-copy-shared";

type Ctx = {
  pages: Record<UiPageId, Record<string, UiCopyElement>>;
  loading: boolean;
  getText: (page: UiPageId, k: string, def: string) => string;
  getElement: (page: UiPageId, k: string) => UiCopyElement | undefined;
};

const UiCopyContext = createContext<Ctx | null>(null);

export function UiCopyProvider({ children }: { children: ReactNode }) {
  const [pages, setPagesState] = useState<Record<UiPageId, Record<string, UiCopyElement>>>({
    home: {},
    dashboard: {},
    session: {},
    settings: {},
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/app/ui-copy")
      .then((r) => (r.ok ? r.json() : { pages: {} }))
      .then((d: { pages?: Record<string, Record<string, UiCopyElement>> }) => {
        const p = d.pages;
        if (!p || typeof p !== "object") {
          setPagesState({ home: {}, dashboard: {}, session: {}, settings: {} });
          return;
        }
        setPagesState({
          home: p.home ?? {},
          dashboard: p.dashboard ?? {},
          session: p.session ?? {},
          settings: p.settings ?? {},
        });
      })
      .catch(() =>
        setPagesState({ home: {}, dashboard: {}, session: {}, settings: {} })
      )
      .finally(() => setLoading(false));
  }, []);

  const getElement = useCallback(
    (page: UiPageId, k: string) => pages[page]?.[k],
    [pages]
  );

  const getText = useCallback(
    (page: UiPageId, k: string, def: string) => pages[page]?.[k]?.text ?? def,
    [pages]
  );

  const value = useMemo(
    () => ({ pages, loading, getText, getElement }),
    [pages, loading, getText, getElement]
  );

  return <UiCopyContext.Provider value={value}>{children}</UiCopyContext.Provider>;
}

export function useUiCopy() {
  const ctx = useContext(UiCopyContext);
  if (!ctx) {
    return {
      pages: { home: {}, dashboard: {}, session: {}, settings: {} } as Record<
        UiPageId,
        Record<string, UiCopyElement>
      >,
      loading: true,
      getText: (_page: UiPageId, _k: string, def: string) => def,
      getElement: () => undefined as UiCopyElement | undefined,
    };
  }
  return ctx;
}

function styleFromEl(el: UiCopyElement | undefined): CSSProperties | undefined {
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

/** Applies admin-configured copy and inline typography for a keyed string on a given page. */
export function SuiText({
  page,
  k,
  def,
  className,
  as: Tag = "span",
  children,
}: {
  page: UiPageId;
  k: string;
  def: string;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
  children?: ReactNode;
}) {
  const ctx = useUiCopy();
  const el = ctx.getElement(page, k);
  const style = styleFromEl(el);
  const text = el?.text ?? def;
  return (
    <Tag className={className} style={style}>
      {text}
      {children}
    </Tag>
  );
}
