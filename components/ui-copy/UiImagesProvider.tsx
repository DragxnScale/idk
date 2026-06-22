"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { UiPageId } from "@/lib/ui-copy-shared";
import type { UiImageElement } from "@/lib/ui-images-shared";

type Ctx = {
  images: Record<UiPageId, Record<string, UiImageElement>>;
  loading: boolean;
  getSrc: (page: UiPageId, k: string, defSrc: string) => string;
  patchImage: (page: UiPageId, k: string, element: UiImageElement) => void;
};

const UiImagesContext = createContext<Ctx | null>(null);

export function UiImagesProvider({ children }: { children: ReactNode }) {
  const [images, setImages] = useState<Record<UiPageId, Record<string, UiImageElement>>>({
    home: {},
    dashboard: {},
    session: {},
    settings: {},
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/app/ui-images")
      .then((r) => (r.ok ? r.json() : { images: {} }))
      .then((d: { images?: Record<string, Record<string, UiImageElement>> }) => {
        const p = d.images;
        if (!p || typeof p !== "object") {
          setImages({ home: {}, dashboard: {}, session: {}, settings: {} });
          return;
        }
        setImages({
          home: p.home ?? {},
          dashboard: p.dashboard ?? {},
          session: p.session ?? {},
          settings: p.settings ?? {},
        });
      })
      .catch(() =>
        setImages({ home: {}, dashboard: {}, session: {}, settings: {} })
      )
      .finally(() => setLoading(false));
  }, []);

  const getSrc = useCallback(
    (page: UiPageId, k: string, defSrc: string) => images[page]?.[k]?.src ?? defSrc,
    [images]
  );

  const patchImage = useCallback((page: UiPageId, k: string, element: UiImageElement) => {
    setImages((prev) => ({
      ...prev,
      [page]: { ...prev[page], [k]: element },
    }));
  }, []);

  const value = useMemo(
    () => ({ images, loading, getSrc, patchImage }),
    [images, loading, getSrc, patchImage]
  );

  return <UiImagesContext.Provider value={value}>{children}</UiImagesContext.Provider>;
}

export function useUiImages() {
  const ctx = useContext(UiImagesContext);
  if (!ctx) {
    return {
      images: { home: {}, dashboard: {}, session: {}, settings: {} } as Record<
        UiPageId,
        Record<string, UiImageElement>
      >,
      loading: true,
      getSrc: (_page: UiPageId, _k: string, defSrc: string) => defSrc,
      patchImage: () => {},
    };
  }
  return ctx;
}
