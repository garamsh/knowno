import { encodeJpeg } from "@/design/encode-jpeg";

/** The longest side the app sends a photo at, in pixels ([`ai-extraction.md`]'s photo rules). */
const maxSide = 2048;

/** The largest photo a Server Action takes under Next's default 1 MB body, with room for the form. */
export const maxTrialBytes = 900_000;

/**
 * [file] as the app would send it: upright, its long side at most 2048 px, a JPEG at quality 85,
 * stepping down to 40 until it fits [maxTrialBytes]; null when the browser cannot decode it or no
 * quality fits.
 */
export async function encodePhoto(file: File): Promise<File | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (let quality = 85; quality >= 40; quality -= 15) {
    const blob = encodeJpeg(canvas, quality / 100);
    if (blob.size <= maxTrialBytes) {
      return new File([blob], "photo.jpg", { type: "image/jpeg" });
    }
  }
  return null;
}
