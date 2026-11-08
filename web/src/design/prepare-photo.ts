import { encodeJpeg } from "./encode-jpeg";

/** The longest side, in pixels, of a photo sent for reading, as the phone's `maxLongSide`. */
export const maxLongSide = 2048;
/** The most bytes a prepared photo takes: inside a Server Action's 6 MiB and the chat bucket's. */
export const maxUploadBytes = 3 * 1024 * 1024;
const qualities = [0.85, 0.7, 0.55, 0.4];

/**
 * Prepares any chosen photo as the phone's `downscalePhoto` does: decoded upright by its EXIF
 * orientation, scaled to at most [maxLongSide] on its long side, and JPEG-encoded under
 * [maxUploadBytes]. A file the browser cannot decode is `unreadable`; one too large even at the
 * lowest quality is `refused`.
 */
export async function downscalePhoto(file: Blob): Promise<File | "unreadable" | "refused"> {
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return "unreadable";
  }
  try {
    const ratio = Math.min(1, maxLongSide / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return "unreadable";
    // JPEG has no alpha: a transparent PNG's background is drawn white, not black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of qualities) {
      const blob = encodeJpeg(canvas, quality);
      if (blob && blob.size <= maxUploadBytes)
        return new File([blob], "photo.jpg", { type: "image/jpeg" });
    }
    return "refused";
  } finally {
    image.close();
  }
}
