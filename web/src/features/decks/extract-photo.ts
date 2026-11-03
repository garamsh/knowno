import { readPhoto } from "./actions";
import type { PhotoFailure } from "./photo-failure";
import type { Extraction } from "./read-photo";

import { encodeJpeg } from "@/design/encode-jpeg";

/** The longest side, in pixels, of a photo sent for extraction, as the phone's `maxLongSide`. */
export const maxLongSide = 2048;
/** The upload bound `readPhoto` accepts, inside the Server Action's 6 MiB request limit. */
export const maxUploadBytes = 3 * 1024 * 1024;
const qualities = [0.85, 0.7, 0.55, 0.4];

/**
 * Prepares any chosen photo as the phone's `downscalePhoto` does: decoded upright by its EXIF
 * orientation, scaled to at most [maxLongSide] on its long side, and JPEG-encoded under
 * [maxUploadBytes]. A file the browser cannot decode is `unreadable`; one too large even at the
 * lowest quality is `refused`.
 */
export async function preparePhoto(file: Blob): Promise<File | PhotoFailure> {
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { kind: "unreadable" };
  }
  try {
    const ratio = Math.min(1, maxLongSide / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return { kind: "unreadable" };
    // JPEG has no alpha: a transparent PNG's background is drawn white, not black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of qualities) {
      const blob = encodeJpeg(canvas, quality);
      if (blob && blob.size <= maxUploadBytes)
        return new File([blob], "photo.jpg", { type: "image/jpeg" });
    }
    return { kind: "refused" };
  } finally {
    image.close();
  }
}

/**
 * Sends one prepared photo, reading its page on from [cursor] when given; a call that never
 * reaches the Server Action is `offline`.
 */
export async function sendPhoto(upload: File, cursor: string | null = null): Promise<Extraction> {
  const form = new FormData();
  form.set("photo", upload);
  if (cursor) form.set("cursor", cursor);
  try {
    return await readPhoto(form);
  } catch {
    return { failure: { kind: "offline" } };
  }
}
