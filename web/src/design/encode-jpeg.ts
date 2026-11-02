/**
 * [canvas] as a JPEG at [quality], encoded at once. Chromium's `toBlob` and `convertToBlob` encode
 * only in the main thread's idle time, forcing it 1 s and then 5 s on, so on a busy page a photo
 * waited up to 6.7 s (#576).
 */
export function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Blob {
  const url = canvas.toDataURL("image/jpeg", quality);
  const text = atob(url.slice(url.indexOf(",") + 1));
  const bytes = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at += 1) bytes[at] = text.charCodeAt(at);
  return new Blob([bytes], { type: "image/jpeg" });
}
