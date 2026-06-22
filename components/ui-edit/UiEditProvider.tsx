"use client";

import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { UiCopyElement, UiPageId } from "@/lib/ui-copy-shared";
import { compoundKey } from "@/lib/ui-copy-shared";
import { TextEditPanel } from "./TextEditPanel";
import { ImageEditFlow } from "./ImageEditFlow";
import { ConfirmModal } from "./ConfirmModal";
import { useUiCopy } from "@/components/ui-copy/UiCopyProvider";
import { useUiImages } from "@/components/ui-copy/UiImagesProvider";
import { UiEditContext, type UiEditCtx } from "./UiEditContext";

type TextEditState = {
  page: UiPageId;
  k: string;
  defaultText: string;
  element: UiCopyElement;
  initialElement: UiCopyElement | undefined;
  anchor: { x: number; y: number };
};

type ImageEditState = {
  page: UiPageId;
  k: string;
  currentSrc: string;
};

export function UiEditProvider({ children }: { children: ReactNode }) {
  const { getElement, patchElement } = useUiCopy();
  const { patchImage } = useUiImages();

  const [textEdit, setTextEdit] = useState<TextEditState | null>(null);
  const [imageEdit, setImageEdit] = useState<ImageEditState | null>(null);
  const [showTextConfirm, setShowTextConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const openTextEditor = useCallback(
    (page: UiPageId, k: string, defaultText: string, anchor: { x: number; y: number }) => {
      const existing = getElement(page, k);
      setTextEdit({
        page,
        k,
        defaultText,
        element: existing ? { ...existing } : {},
        initialElement: existing ? { ...existing } : undefined,
        anchor,
      });
      setShowTextConfirm(false);
      setSaveError(null);
    },
    [getElement]
  );

  const openImageEditor = useCallback((page: UiPageId, k: string, currentSrc: string) => {
    setImageEdit({ page, k, currentSrc });
  }, []);

  const updateTextElement = useCallback((patch: Partial<UiCopyElement>) => {
    setTextEdit((prev) => (prev ? { ...prev, element: { ...prev.element, ...patch } } : prev));
  }, []);

  const undoText = useCallback(() => {
    setTextEdit((prev) =>
      prev ? { ...prev, element: prev.initialElement ? { ...prev.initialElement } : {} } : prev
    );
  }, []);

  const requestTextConfirm = useCallback(() => {
    setShowTextConfirm(true);
  }, []);

  const saveText = useCallback(async () => {
    if (!textEdit) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/admin/ui-copy/item", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: textEdit.page,
          k: textEdit.k,
          element: textEdit.element,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      patchElement(textEdit.page, textEdit.k, textEdit.element);
      setTextEdit(null);
      setShowTextConfirm(false);
    } catch {
      setSaveError("Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }, [textEdit, patchElement]);

  const value = useMemo<UiEditCtx>(
    () => ({
      editMode: true,
      openTextEditor,
      openImageEditor,
    }),
    [openTextEditor, openImageEditor]
  );

  const compound = textEdit ? compoundKey(textEdit.page, textEdit.k) : "";
  const beforeText = textEdit
    ? textEdit.initialElement?.text ?? textEdit.defaultText
    : "";
  const afterText = textEdit?.element.text ?? textEdit?.defaultText ?? "";

  return (
    <UiEditContext.Provider value={value}>
      {children}

      {textEdit && !showTextConfirm && (
        <TextEditPanel
          compoundKey={compound}
          element={textEdit.element}
          defaultText={textEdit.defaultText}
          anchor={textEdit.anchor}
          onChange={updateTextElement}
          onRequestConfirm={requestTextConfirm}
          onClose={() => setTextEdit(null)}
          onUndo={undoText}
        />
      )}

      {textEdit && showTextConfirm && (
        <ConfirmModal
          open
          title="Save text change?"
          onConfirm={() => void saveText()}
          onCancel={() => setShowTextConfirm(false)}
          confirming={saving}
        >
          <div className="space-y-2">
            <div>
              <p className="text-xs text-slate-400 mb-1">Before</p>
              <p className="rounded-lg bg-slate-800 px-3 py-2 text-white">{beforeText}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-1">After</p>
              <p className="rounded-lg bg-slate-800 px-3 py-2 text-white">{afterText}</p>
            </div>
            {saveError && <p className="text-sm text-red-400">{saveError}</p>}
          </div>
        </ConfirmModal>
      )}

      {imageEdit && (
        <ImageEditFlow
          page={imageEdit.page}
          k={imageEdit.k}
          currentSrc={imageEdit.currentSrc}
          onClose={() => setImageEdit(null)}
          onSaved={(src) => patchImage(imageEdit.page, imageEdit.k, { src })}
        />
      )}
    </UiEditContext.Provider>
  );
}
