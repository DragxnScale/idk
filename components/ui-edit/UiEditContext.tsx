"use client";

import { createContext, useContext } from "react";
import type { UiPageId } from "@/lib/ui-copy-shared";

export type UiEditCtx = {
  editMode: boolean;
  openTextEditor: (
    page: UiPageId,
    k: string,
    defaultText: string,
    anchor: { x: number; y: number }
  ) => void;
  openImageEditor: (page: UiPageId, k: string, currentSrc: string) => void;
};

export const UiEditContext = createContext<UiEditCtx | null>(null);

export function useUiEdit() {
  return useContext(UiEditContext);
}
