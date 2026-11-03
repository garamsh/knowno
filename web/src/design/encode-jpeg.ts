/**
 * [canvas] as a JPEG at [quality], encoded at once, or null where the browser could not encode it:
 * an empty `data:,` or, without a JPEG encoder, a PNG. Chromium's `toBlob` and `convertToBlob`
 * encode only in the main thread's idle time, forcing it 1 s and then 5 s on, so on a busy page a
 * photo waited up to 6.7 s (#576).
 */
export function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Blob | null {
  const url = canvas.toDataURL("image/jpeg", quality);
  const prefix = "data:image/jpeg;base64,";
  if (!url.startsWith(prefix)) return null;
  const text = atob(url.slice(prefix.length));
  const bytes = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at += 1) bytes[at] = text.charCodeAt(at);
  return new Blob([bytes], { type: "image/jpeg" });
}
