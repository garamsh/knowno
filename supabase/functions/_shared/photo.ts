/**
 * A photo fetched from an https URL for `add_cards` (ADR 0144): the URL is untrusted, so each hop
 * is checked for a public address before it is requested, and the bytes decide the type and size.
 * The file is stored as it came; nothing decodes or re-encodes it.
 */

/** The address lookup and clock a fetch uses, which a test replaces. */
export type PhotoDeps = {
  readonly fetch: typeof fetch;
  /** Every A and AAAA address of [host]; empty when it has none. */
  readonly resolve: (host: string, signal: AbortSignal) => Promise<string[]>;
  /** A signal that aborts after [ms]. */
  readonly timeout: (ms: number) => AbortSignal;
};

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

/** A fetched photo, ready to store. */
export type Photo = {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mimeType: ImageType;
  readonly width: number;
  readonly height: number;
};

/** The bucket's ceiling, the `media` row's `byte_size` check (`server.md` §Media storage). */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
/** Covers every hop and the body together, so ten photos stay under the platform's wall clock. */
export const PHOTO_TIMEOUT_MS = 10_000;

const FAILED =
  "The photo could not be fetched: use an https address that answers with the image itself.";
const NOT_PUBLIC =
  "The photo's address is not a public https address: use an image on the public internet.";

function ipv4(text: string): number {
  return text.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);
}

/** IPv4 ranges that are not the public internet, as [first address, prefix length]. */
const PRIVATE_IPV4: readonly (readonly [number, number])[] = [
  [ipv4("0.0.0.0"), 8],
  [ipv4("10.0.0.0"), 8],
  [ipv4("100.64.0.0"), 10],
  [ipv4("127.0.0.0"), 8],
  [ipv4("169.254.0.0"), 16],
  [ipv4("172.16.0.0"), 12],
  [ipv4("192.0.0.0"), 24],
  [ipv4("192.0.2.0"), 24],
  [ipv4("192.168.0.0"), 16],
  [ipv4("198.18.0.0"), 15],
  [ipv4("198.51.100.0"), 24],
  [ipv4("203.0.113.0"), 24],
  [ipv4("224.0.0.0"), 4],
  [ipv4("240.0.0.0"), 4],
];

function isIpv4(text: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(text) &&
    text.split(".").every((part) => Number(part) <= 255);
}

/** The eight groups of an IPv6 address, or null when it is not one. */
function hextets(text: string): number[] | null {
  const ends = text.split("::");
  if (ends.length > 2) return null;
  const groups = (part: string) => part === "" ? [] : part.split(":");
  const expand = (parts: string[]) =>
    parts.flatMap((part) => {
      if (!part.includes(".")) return [part];
      if (!isIpv4(part)) return ["x"];
      const value = ipv4(part);
      return [
        Math.floor(value / 65536).toString(16),
        (value % 65536).toString(16),
      ];
    });
  const head = expand(groups(ends[0]));
  const tail = expand(groups(ends[1] ?? ""));
  const missing = 8 - head.length - tail.length;
  if (ends.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array(missing).fill("0"), ...tail];
  return all.every((group) => /^[0-9a-f]{1,4}$/i.test(group))
    ? all.map((group) => parseInt(group, 16))
    : null;
}

/**
 * Whether [address] is on the public internet. IPv6 is held to global unicast, 2000::/3, without
 * its documentation, Teredo and 6to4 ranges, so every form embedding an IPv4 address is refused,
 * IPv4-mapped and NAT64 included.
 */
export function isPublicAddress(address: string): boolean {
  if (isIpv4(address)) {
    const value = ipv4(address);
    return !PRIVATE_IPV4.some(([first, bits]) => {
      const size = 2 ** (32 - bits);
      return Math.floor(value / size) === Math.floor(first / size);
    });
  }
  const groups = hextets(address);
  if (groups === null) return false;
  const [first, second] = groups;
  if ((first & 0xe000) !== 0x2000 || first === 0x2002) return false;
  return !(first === 0x2001 && (second === 0 || second === 0xdb8));
}

/** Why [url] may not be requested, or null. A hostname's every address must be public. */
async function refusal(
  url: URL,
  deps: PhotoDeps,
  signal: AbortSignal,
): Promise<string | null> {
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    return NOT_PUBLIC;
  }
  // The URL parser has already turned a decimal or hex host into dotted form.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIpv4(host) || host.includes(":")) {
    return isPublicAddress(host) ? null : NOT_PUBLIC;
  }
  const addresses = await deps.resolve(host, signal);
  if (addresses.length === 0) {
    return "The photo's host has no address: check the url.";
  }
  return addresses.every(isPublicAddress) ? null : NOT_PUBLIC;
}

/** [response]'s body, or null once it passes the cap. */
async function cappedBody(
  response: Response,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = response.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_PHOTO_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

const opens = (bytes: Uint8Array, at: number, ascii: string) =>
  [...ascii].every((char, index) => bytes[at + index] === char.charCodeAt(0));

/** The image type [bytes] open with, or null for any other file. */
export function imageTypeOf(bytes: Uint8Array): ImageType | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes[0] === 0x89 && opens(bytes, 1, "PNG\r\n\x1a\n")) return "image/png";
  return opens(bytes, 0, "RIFF") && opens(bytes, 8, "WEBP")
    ? "image/webp"
    : null;
}

type Size = { readonly width: number; readonly height: number };

const u16 = (bytes: Uint8Array, at: number) => (bytes[at] << 8) | bytes[at + 1];
const u16le = (bytes: Uint8Array, at: number) =>
  bytes[at] | (bytes[at + 1] << 8);
const u24le = (bytes: Uint8Array, at: number) =>
  u16le(bytes, at) | (bytes[at + 2] << 16);

function pngSize(bytes: Uint8Array): Size | null {
  if (!opens(bytes, 12, "IHDR")) return null;
  return {
    width: u16(bytes, 16) * 65536 + u16(bytes, 18),
    height: u16(bytes, 20) * 65536 + u16(bytes, 22),
  };
}

function webpSize(bytes: Uint8Array): Size | null {
  if (opens(bytes, 12, "VP8X")) {
    return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
  }
  if (opens(bytes, 12, "VP8L") && bytes[20] === 0x2f) {
    const bits = u16le(bytes, 21) + u16le(bytes, 23) * 65536;
    return {
      width: (bits & 0x3fff) + 1,
      height: (Math.floor(bits / 16384) & 0x3fff) + 1,
    };
  }
  if (
    opens(bytes, 12, "VP8 ") && bytes[23] === 0x9d && bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      width: u16le(bytes, 26) & 0x3fff,
      height: u16le(bytes, 28) & 0x3fff,
    };
  }
  return null;
}

/** The orientation an Exif block at [at] names, 1 when it names none. */
function exifOrientation(bytes: Uint8Array, at: number): number {
  const little = opens(bytes, at, "II");
  const read16 = (offset: number) =>
    little ? u16le(bytes, offset) : u16(bytes, offset);
  const read32 = (offset: number) =>
    little
      ? read16(offset) + read16(offset + 2) * 65536
      : read16(offset) * 65536 + read16(offset + 2);
  const entries = at + read32(at + 4);
  const count = read16(entries);
  for (let index = 0; index < count; index++) {
    const entry = entries + 2 + index * 12;
    if (entry + 12 > bytes.length) break;
    if (read16(entry) === 0x0112) return read16(entry + 8);
  }
  return 1;
}

/** A JPEG's size as drawn: a client applies its Exif orientation, 5 to 8 turning it a quarter. */
function jpegSize(bytes: Uint8Array): Size | null {
  let orientation = 1;
  for (let at = 2; at + 9 < bytes.length;) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      const size = { width: u16(bytes, at + 7), height: u16(bytes, at + 5) };
      return orientation >= 5
        ? { width: size.height, height: size.width }
        : size;
    }
    if (marker === 0xe1 && opens(bytes, at + 4, "Exif\0\0")) {
      orientation = exifOrientation(bytes, at + 10);
    }
    at += 2 + u16(bytes, at + 2);
  }
  return null;
}

/** The size in pixels [bytes] of [type] state, null when the file does not state one. */
export function imageSizeOf(bytes: Uint8Array, type: ImageType): Size | null {
  const size = type === "image/jpeg"
    ? jpegSize(bytes)
    : type === "image/png"
    ? pngSize(bytes)
    : webpSize(bytes);
  return size !== null && size.width > 0 && size.height > 0 ? size : null;
}

async function readPhoto(response: Response): Promise<Photo | string> {
  const tooLarge =
    `The photo is larger than ${MAX_PHOTO_BYTES} bytes: use a smaller image.`;
  if (Number(response.headers.get("Content-Length")) > MAX_PHOTO_BYTES) {
    await response.body?.cancel();
    return tooLarge;
  }
  const header = response.headers.get("Content-Type")?.split(";")[0].trim()
    .toLowerCase();
  if (!(IMAGE_TYPES as readonly (string | undefined)[]).includes(header)) {
    await response.body?.cancel();
    return "The photo's address did not answer with a JPEG, PNG or WebP image: use a url of the image file itself, not a page.";
  }
  const bytes = await cappedBody(response);
  if (bytes === null) return tooLarge;
  const mimeType = imageTypeOf(bytes);
  if (mimeType === null || mimeType !== header) {
    return "The photo's bytes are not the JPEG, PNG or WebP image its address says: use a url of the image file itself.";
  }
  const size = imageSizeOf(bytes, mimeType);
  if (size === null) {
    return "The photo's file states no size, so it cannot be used: use another image.";
  }
  return { bytes, mimeType, ...size };
}

/** The image at [address], or a sentence the model can act on. Sends no credential. */
export async function fetchPhoto(
  address: string,
  deps: PhotoDeps,
): Promise<Photo | string> {
  const signal = deps.timeout(PHOTO_TIMEOUT_MS);
  const parsed = URL.parse(address);
  if (parsed === null) return NOT_PUBLIC;
  let url: URL = parsed;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const refused = await refusal(url, deps, signal);
      if (refused !== null) return refused;
      const response = await deps.fetch(url, {
        redirect: "manual",
        signal,
        headers: { Accept: IMAGE_TYPES.join(", "), "User-Agent": "knowno" },
      });
      if (response.status < 300 || response.status >= 400) {
        if (response.ok) return await readPhoto(response);
        await response.body?.cancel();
        return `${FAILED} It answered ${response.status}.`;
      }
      await response.body?.cancel();
      const location = response.headers.get("Location");
      const next = location === null ? null : URL.parse(location, url);
      if (next === null) return FAILED;
      url = next;
    }
  } catch {
    // A fetch fails only by the network or the deadline, and the card is refused for either.
    return signal.aborted
      ? `The photo did not arrive within ${
        PHOTO_TIMEOUT_MS / 1000
      } seconds: use a faster host or a smaller image.`
      : FAILED;
  }
  return `The photo's address redirected more than ${MAX_REDIRECTS} times: use the image's final url.`;
}
