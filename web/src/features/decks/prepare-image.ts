import { encodeJpeg } from "@/design/encode-jpeg";

/** The longest side, in pixels, of an image the web stores, as the phone's `maxImageSide`. */
export const maxImageSide = 1024;

/**
 * An image made ready to store, as the phone's `PreparedImage`: a JPEG, its SHA-256 in hex, and
 * its width and height in pixels.
 */
export type PreparedImage = { jpeg: Blob; sha256: string; width: number; height: number };

/**
 * The shape a picked photo is prepared in, as the phone's `ImageShape`: `square` for a tile,
 * cropped to its centred square, or `whole` for a card's photo, kept at its aspect ratio.
 */
export type ImageShape = "square" | "whole";

/**
 * Prepares a picked photo as the phone's `cropImage` does: decoded upright by its EXIF
 * orientation, cropped to its centred square for [shape] `square` or kept whole, scaled to at most
 * [maxImageSide] on its longer side, never up, and encoded as JPEG at quality 85, with its digest
 * and size. Null for a file the browser cannot decode.
 */
export async function prepareImage(file: Blob, shape: ImageShape): Promise<PreparedImage | null> {
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  try {
    const square = Math.min(image.width, image.height);
    const [sourceWidth, sourceHeight] =
      shape === "square" ? [square, square] : [image.width, image.height];
    const scale = Math.min(1, maxImageSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    // JPEG has no alpha: a transparent PNG's background is drawn white, not black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(
      image,
      Math.floor((image.width - sourceWidth) / 2),
      Math.floor((image.height - sourceHeight) / 2),
      sourceWidth,
      sourceHeight,
      0,
      0,
      width,
      height,
    );
    const jpeg = encodeJpeg(canvas, 0.85);
    if (!jpeg) return null;
    return { jpeg, sha256: await sha256Of(jpeg), width, height };
  } finally {
    image.close();
  }
}

/** [file]'s SHA-256 in lowercase hex, as the server checks what it stores. */
export async function sha256Of(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
