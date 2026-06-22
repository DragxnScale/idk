"use client";

import { useUiEdit } from "@/components/ui-edit/UiEditContext";
import { useUiImages } from "./UiImagesProvider";
import type { UiPageId } from "@/lib/ui-copy-shared";
import { getImageSlot } from "@/lib/ui-images-shared";

type SuiImageProps = {
  page: UiPageId;
  k: string;
  defSrc: string;
  alt?: string;
  className?: string;
};

export function SuiImage({ page, k, defSrc, alt = "", className }: SuiImageProps) {
  const { getSrc } = useUiImages();
  const uiEdit = useUiEdit();
  const src = getSrc(page, k, defSrc);
  const slot = getImageSlot(page, k);
  const editable = uiEdit?.editMode && !!slot;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={`${className ?? ""}${editable ? " cursor-context-menu hover:ring-2 hover:ring-blue-500/50" : ""}`}
      onContextMenu={
        editable
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              uiEdit.openImageEditor(page, k, src);
            }
          : undefined
      }
    />
  );
}
