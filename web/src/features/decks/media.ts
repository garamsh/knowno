/**
 * The web's path to the user's files in the private `media` bucket (ADR 0159), as the phone's
 * `SupabaseMediaServer` takes it, acting as the signed-in user under row-level security: a file
 * is stored as its `media` row, then the object `{owner}/{media id}`; released as the object,
 * then its row, once no live deck or card of the user's holds it; and drawn from a short-lived
 * signed URL.
 */
import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requestTimeoutMs } from "@/supabase/failure";
import { field } from "@/supabase/row";
import { selectAll } from "@/supabase/select-all";

/** A stored file's id, a uuid, as a deck or a card names it (ADR 0107). */
export type MediaId = string & { readonly brand: "MediaId" };

/** A stored file's kind, as its `media` row and the block naming it record (ADR 0107, ADR 0112). */
export type MediaKind = "image" | "audio";

/**
 * A file made ready to store, as the phone's `PreparedImage` and `PreparedAudio`: its bytes, their
 * SHA-256, its kind and the MIME type its bytes open with.
 */
export type StoredFile = { bytes: Uint8Array; sha256: string; kind: MediaKind; mimeType: string };

const bucket = "media";
/** The server's ceiling for one file (`server.md` §Media storage). */
const maxBytes = 10 * 1024 * 1024;
/** The phone's `maxAudioBytes`, the most a sound holds (ADR 0112). */
const maxSoundBytes = 5 * 1024 * 1024;

/**
 * [file]'s bytes when it holds 1 to [limit] bytes whose SHA-256 is [sha256]; null otherwise, as
 * the request crossed the network.
 */
async function digested(
  file: unknown,
  sha256: unknown,
  limit: number,
): Promise<{ bytes: Uint8Array; sha256: string } | null> {
  if (!(file instanceof Blob) || file.size === 0 || file.size > limit) return null;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  return createHash("sha256").update(bytes).digest("hex") === sha256 ? { bytes, sha256 } : null;
}

/**
 * [file] as an image to store: a JPEG of 1 byte to the server's ceiling whose SHA-256 is
 * [sha256], as the web prepares every photo; null otherwise.
 */
export async function parseImage(file: unknown, sha256: unknown): Promise<StoredFile | null> {
  const read = await digested(file, sha256, maxBytes);
  // A JPEG starts with its start-of-image marker.
  if (!read || read.bytes[0] !== 0xff || read.bytes[1] !== 0xd8 || read.bytes[2] !== 0xff)
    return null;
  return { ...read, kind: "image", mimeType: "image/jpeg" };
}

/**
 * [file] as a sound to store: up to the phone's 5 MiB, its SHA-256 [sha256], its bytes opening as
 * the phone's `mediaTypeOf` reads a sound; null otherwise.
 */
export async function parseSound(file: unknown, sha256: unknown): Promise<StoredFile | null> {
  const read = await digested(file, sha256, maxSoundBytes);
  const mimeType = read && soundType(read.bytes);
  return read && mimeType ? { ...read, kind: "audio", mimeType } : null;
}

/**
 * The MIME type [bytes] open with as a sound: an MPEG-4 `ftyp` box or an ADTS AAC header as
 * `audio/mp4`, an ID3 tag or another layer's frame sync as `audio/mpeg`; null for any other.
 */
function soundType(bytes: Uint8Array): string | null {
  const [first = 0, second = 0, third = 0] = bytes;
  if (String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp") return "audio/mp4";
  // An ADTS header is a frame sync whose layer bits are 00.
  if (first === 0xff && (second & 0xf6) === 0xf0) return "audio/mp4";
  if (first === 0x49 && second === 0x44 && third === 0x33) return "audio/mpeg";
  if (first === 0xff && (second & 0xe0) === 0xe0 && (second & 0x06) !== 0) return "audio/mpeg";
  return null;
}

/**
 * [request]'s answer, or a timeout's error once [requestTimeoutMs] pass, as the phone bounds it.
 * A race, since storage-js 2.118.0 takes no abort signal on `upload`, `remove` or
 * `createSignedUrls`: it stops the wait, not the request.
 */
async function bounded<T extends { error: unknown }>(
  request: PromiseLike<T>,
): Promise<T | { error: "timeout" }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ error: "timeout" }>((resolve) => {
    timer = setTimeout(() => {
      resolve({ error: "timeout" });
    }, requestTimeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stores [file] under [id] in [userId]'s folder: the `media` row, keeping one already there,
 * then the object, which counts as stored when Storage already holds it, so a retry after a lost
 * answer succeeds. False when either is refused or unanswered.
 */
export async function storeFile(
  client: SupabaseClient,
  userId: string,
  id: MediaId,
  file: StoredFile,
): Promise<boolean> {
  const row = await client
    .from("media")
    .upsert(
      {
        user_id: userId,
        id,
        kind: file.kind,
        mime_type: file.mimeType,
        byte_size: file.bytes.byteLength,
        sha256: file.sha256,
      },
      { onConflict: "user_id,id", ignoreDuplicates: true },
    )
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (row.error) return false;
  const upload = await bounded(
    client.storage
      .from(bucket)
      .upload(`${userId}/${id}`, file.bytes, { contentType: file.mimeType, upsert: false }),
  );
  return !upload.error || field(upload.error, "statusCode") === "409";
}

/**
 * Releases those of [candidates] no live deck or card of [userId]'s holds, as the phone's
 * `_releaseUnheld` once a write is made: a deck holds its image, and a card any side naming the
 * id, so a block this build cannot read holds it too. The object goes, then its row. Answers the
 * ids it could not release, whose files stay; the write before it stands either way.
 */
export async function releaseUnheld(
  client: SupabaseClient,
  userId: string,
  candidates: readonly MediaId[],
): Promise<MediaId[]> {
  const wanted = [...new Set(candidates)];
  if (wanted.length === 0) return [];
  const [decks, cards] = await Promise.all([
    client
      .from("decks")
      .select("image_media_id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .in("image_media_id", wanted)
      .abortSignal(AbortSignal.timeout(requestTimeoutMs)),
    selectAll((from, to, counted) =>
      client
        .from("cards")
        .select("front, back", counted ? { count: "exact" } : {})
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("id")
        .range(from, to)
        .abortSignal(AbortSignal.timeout(requestTimeoutMs)),
    ),
  ]);
  if (decks.error || !Array.isArray(decks.data) || "failure" in cards) return wanted;
  const deckImages = new Set(decks.data.map((row: unknown) => field(row, "image_media_id")));
  const sides = cards.rows.map((row) => JSON.stringify([field(row, "front"), field(row, "back")]));
  const free = wanted.filter(
    (id) => !deckImages.has(id) && !sides.some((side) => side.includes(id)),
  );
  if (free.length === 0) return [];
  const removed = await bounded(
    client.storage.from(bucket).remove(free.map((id) => `${userId}/${id}`)),
  );
  if (removed.error) return free;
  const rows = await client
    .from("media")
    .delete()
    .eq("user_id", userId)
    .in("id", free)
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  return rows.error ? free : [];
}

/**
 * A signed URL for each of [ids] in [userId]'s folder that Storage holds and lets the user read,
 * valid for [seconds], in one request; an id it refuses, or every id when signing fails, has none,
 * and is drawn as the phone draws a file it cannot read: by its fallback.
 */
export async function signMedia(
  client: SupabaseClient,
  userId: string,
  ids: readonly string[],
  seconds: number,
): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return signed;
  const answer = await bounded(
    client.storage.from(bucket).createSignedUrls(
      wanted.map((id) => `${userId}/${id}`),
      seconds,
    ),
  );
  if (answer.error || !("data" in answer)) return signed;
  for (const { path, signedUrl, error } of answer.data) {
    const id = wanted.find((candidate) => path === `${userId}/${candidate}`);
    if (id && signedUrl && !error) signed.set(id, signedUrl);
  }
  return signed;
}

/**
 * Whether each of [wanted] names a `media` row of [userId]'s of its kind, so a card names only a
 * file the user stored; null when the read fails.
 */
export async function holdsMedia(
  client: SupabaseClient,
  userId: string,
  wanted: readonly { media: string; kind: MediaKind }[],
): Promise<boolean | null> {
  if (wanted.length === 0) return true;
  // An id that is not a uuid names no file the user could have stored.
  if (wanted.some(({ media }) => !parseMediaId(media))) return false;
  const rows = await client
    .from("media")
    .select("id, kind")
    .eq("user_id", userId)
    .in("id", [...new Set(wanted.map(({ media }) => media))])
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (rows.error || !Array.isArray(rows.data)) return null;
  const kinds = new Map(rows.data.map((row: unknown) => [field(row, "id"), field(row, "kind")]));
  return wanted.every(({ media, kind }) => kinds.get(media) === kind);
}

/** [value] as a media id, or null when it is not a uuid. */
export function parseMediaId(value: unknown): MediaId | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
    ? (value as MediaId)
    : null;
}
