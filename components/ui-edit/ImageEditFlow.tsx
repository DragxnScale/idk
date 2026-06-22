"use client";

import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import type { UiPageId } from "@/lib/ui-copy-shared";
import { getImageSlot } from "@/lib/ui-images-shared";
import { getCroppedImageBlob } from "@/lib/crop-image";
import { ConfirmModal } from "./ConfirmModal";

type ImageEditFlowProps = {
  page: UiPageId;
  k: string;
  currentSrc: string;
  onClose: () => void;
  onSaved: (src: string) => void;
};

type Step = "pick" | "crop" | "confirm";

export function ImageEditFlow({ page, k, currentSrc, onClose, onSaved }: ImageEditFlowProps) {
  const slot = getImageSlot(page, k);
  const [step, setStep] = useState<Step>("pick");
  const [rawUrl, setRawUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== "confirm") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  useEffect(() => {
    return () => {
      if (rawUrl) URL.revokeObjectURL(rawUrl);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [rawUrl, previewUrl]);

  const onFilePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setError(null);
    const url = URL.createObjectURL(file);
    setRawUrl(url);
    setStep("crop");
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  const prepareConfirm = useCallback(async () => {
    if (!rawUrl || !croppedArea || !slot) return;
    setError(null);
    try {
      const blob = await getCroppedImageBlob(
        rawUrl,
        croppedArea,
        slot.exportWidth,
        slot.exportHeight
      );
      const url = URL.createObjectURL(blob);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setStep("confirm");
    } catch {
      setError("Could not crop image. Try another file.");
    }
  }, [rawUrl, croppedArea, slot]);

  useEffect(() => {
    if (step !== "crop") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void prepareConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, prepareConfirm]);

  const uploadAndSave = useCallback(async () => {
    if (!previewUrl) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(previewUrl);
      const blob = await res.blob();
      const uploadInit = await fetch("/api/admin/ui-images/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, k, contentType: "image/png" }),
      });
      if (!uploadInit.ok) throw new Error("Could not get upload URL");
      const { uploadUrl, objectUrl } = (await uploadInit.json()) as {
        uploadUrl: string;
        objectUrl: string;
      };
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: blob,
      });
      if (!putRes.ok) throw new Error("Upload failed");

      const patchRes = await fetch("/api/admin/ui-images/item", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, k, element: { src: objectUrl } }),
      });
      if (!patchRes.ok) throw new Error("Could not save image");

      onSaved(objectUrl);
      onClose();
    } catch (err) {
      setError((err as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [previewUrl, page, k, onSaved, onClose]);

  if (!slot) return null;

  if (step === "confirm") {
    return (
      <ConfirmModal
        open
        title={`Replace ${slot.label}?`}
        onConfirm={() => void uploadAndSave()}
        onCancel={() => setStep("crop")}
        confirming={saving}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-400 mb-2">Current</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={currentSrc} alt="" className="w-full rounded-lg border border-slate-700 object-cover" />
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-2">New</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl ?? ""} alt="" className="w-full rounded-lg border border-slate-700 object-cover" />
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </ConfirmModal>
    );
  }

  return (
    <div className="fixed inset-0 z-[95] flex flex-col bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <h3 className="text-sm font-semibold text-white">
          {step === "pick" ? `Replace ${slot.label}` : `Crop ${slot.label}`}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-white text-lg"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {step === "pick" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
          <p className="text-sm text-slate-400 text-center max-w-md">
            Choose an image to replace <strong className="text-slate-200">{slot.label}</strong>.
            {slot.exportWidth && (
              <> Target size: {slot.exportWidth}
                {slot.exportHeight ? `×${slot.exportHeight}` : "px wide"}.</>
            )}
          </p>
          <label className="cursor-pointer rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-500">
            Choose image
            <input type="file" accept="image/*" className="hidden" onChange={onFilePick} />
          </label>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      )}

      {step === "crop" && rawUrl && (
        <>
          <div className="relative flex-1 bg-black">
            <Cropper
              image={rawUrl}
              crop={crop}
              zoom={zoom}
              aspect={slot.aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, area) => setCroppedArea(area)}
            />
          </div>
          <div className="border-t border-slate-700 p-4 space-y-3">
            <label className="flex items-center gap-3 text-sm text-slate-300">
              Zoom
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1"
              />
            </label>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setStep("pick")}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void prepareConfirm()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white"
              >
                Continue (Enter)
              </button>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}
