/**
 * Parses the request body: one base64 image of a supported type, optional language hints, and the
 * cursor of a request that goes on reading the photo (ADR 0138).
 */

import {
  type Cursor,
  decodeCursor,
  MAX_CURSOR_LENGTH,
} from "./continuation.ts";

export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
// Base64 of the largest image and the longest cursor, plus room for the JSON around them.
const MAX_BODY_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + MAX_CURSOR_LENGTH +
  64 * 1024;

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

/** An image whose decoded size and type have been checked; `base64` is never logged or stored. */
export type Image = { readonly type: ImageType; readonly base64: string };

/** A BCP 47 language tag, such as `en` or `ko`, for one side of the deck. */
export type LanguageTag = string & { readonly __brand: "LanguageTag" };

export type LanguageHints = {
  readonly front?: LanguageTag;
  readonly back?: LanguageTag;
};

export type ExtractRequest = {
  readonly image: Image;
  readonly languages: LanguageHints;
  /** Where to go on reading the photo from, or null for its first read. */
  readonly cursor: Cursor | null;
  /**
   * The AI configuration an admin's trial names (ADR 0162), or null for the one the caller's plan
   * serves; the server serves a named one to an admin only.
   */
  readonly configuration: number | null;
};

export type RequestFailure = "bad_request" | "too_large" | "unsupported_type";

export type ParsedRequest =
  | { readonly ok: true; readonly request: ExtractRequest }
  | { readonly ok: false; readonly failure: RequestFailure };

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** Reads at most the body size an accepted image can take, and parses it. */
export async function parseRequest(
  body: ReadableStream<Uint8Array> | null,
): Promise<ParsedRequest> {
  if (body === null) return refuse("bad_request");
  const bytes = await readAtMost(body, MAX_BODY_BYTES);
  if (bytes === null) return refuse("too_large");

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return refuse("bad_request");
  }
  if (!isRecord(value)) return refuse("bad_request");

  const base64 = value.image;
  if (
    typeof base64 !== "string" || base64.length % 4 !== 0 ||
    !BASE64.test(base64)
  ) {
    return refuse("bad_request");
  }
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  if ((base64.length / 4) * 3 - padding > MAX_IMAGE_BYTES) {
    return refuse("too_large");
  }
  const type = sniffType(base64);
  if (type === null) return refuse("unsupported_type");

  const languages = parseLanguages(value.languages);
  if (languages === null) return refuse("bad_request");
  let cursor: Cursor | null = null;
  if (value.cursor !== undefined) {
    cursor = typeof value.cursor === "string"
      ? decodeCursor(value.cursor)
      : null;
    if (cursor === null) return refuse("bad_request");
  }
  const configuration = value.configuration_id ?? null;
  if (
    configuration !== null &&
    !(typeof configuration === "number" &&
      Number.isSafeInteger(configuration) &&
      configuration > 0)
  ) return refuse("bad_request");
  return {
    ok: true,
    request: { image: { type, base64 }, languages, cursor, configuration },
  };
}

/** The type the image's leading bytes declare; a declared MIME type is not trusted. */
function sniffType(base64: string): ImageType | null {
  const head = Uint8Array.from(
    atob(base64.slice(0, 16)),
    (c) => c.charCodeAt(0),
  );
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...head.slice(from, to));
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return "image/jpeg";
  }
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

function parseLanguages(value: unknown): LanguageHints | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const hints: { front?: LanguageTag; back?: LanguageTag } = {};
  for (const [key, tag] of Object.entries(value)) {
    if (
      (key !== "front" && key !== "back") || typeof tag !== "string" ||
      !LANGUAGE_TAG.test(tag)
    ) {
      return null;
    }
    hints[key] = tag as LanguageTag;
  }
  return hints;
}

async function readAtMost(
  body: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function refuse(failure: RequestFailure): ParsedRequest {
  return { ok: false, failure };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
