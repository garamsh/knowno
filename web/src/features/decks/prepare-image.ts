/** The longest side, in pixels, of an image the web stores, as the phone's `maxImageSide`. */
export const maxImageSide = 1024;

/** An image made ready to store, as the phone's `PreparedImage`: a JPEG and its SHA-256 in hex. */
export type PreparedImage = { jpeg: Blob; sha256: string };

/**
 * Prepares a picked photo for a tile as the phone's `cropImage` does: decoded upright by its EXIF
 * orientation, cropped to its centred square, scaled to at most [maxImageSide] a side, never up,
 * and encoded as JPEG at quality 85, with its digest. Null for a file the browser cannot decode.
 */
export async function cropImage(file: Blob): Promise<PreparedImage | null> {
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  try {
    const square = Math.min(image.width, image.height);
    const side = Math.max(1, Math.min(square, maxImageSide));
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext("2d");
    if (!context) return null;
    // JPEG has no alpha: a transparent PNG's background is drawn white, not black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, side, side);
    context.drawImage(
      image,
      Math.floor((image.width - square) / 2),
      Math.floor((image.height - square) / 2),
      square,
      square,
      0,
      0,
      side,
      side,
    );
    const jpeg = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.85);
    });
    if (!jpeg) return null;
    const digest = await crypto.subtle.digest("SHA-256", await jpeg.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return { jpeg, sha256 };
  } finally {
    image.close();
  }
}
