/** Canvas crop helper for react-easy-crop Area type. */

export type CropArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export async function getCroppedImageBlob(
  imageSrc: string,
  crop: CropArea,
  exportWidth?: number,
  exportHeight?: number
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  const outW = exportWidth ?? Math.round(crop.width);
  const outH = exportHeight ?? Math.round(crop.height);
  canvas.width = outW;
  canvas.height = outH;

  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    outW,
    outH
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to export image"))),
      "image/png"
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}
