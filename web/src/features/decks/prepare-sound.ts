import { sha256Of } from "./prepare-image";

/** The phone's `maxAudioDuration` and `maxAudioBytes`: a sound's limits (ADR 0112). */
export const maxSoundMs = 60_000;
const maxSoundBytes = 5 * 1024 * 1024;

/** A sound made ready to store, as the phone's `PreparedAudio`: its file, digest and length. */
export type PreparedSound = { file: Blob; sha256: string; durationMs: number };

/** Why a sound was not taken: the phone's `MediaUnreadable` or `MediaTooLarge`. */
export type SoundProblem = "unreadable" | "tooLarge";

/**
 * Prepares a sound as the phone's `prepareAudio` holds it to its limits: a recording of
 * [durationMs], or a picked `.m4a` or `.mp3` kept as it is, its length read by [lengthOf], the
 * browser's player unless a test passes one. One past 60 seconds or 5 MiB is `tooLarge`; one of
 * another kind, or that no player reads, `unreadable`.
 */
export async function prepareSound(
  file: Blob,
  durationMs?: number,
  lengthOf: (file: Blob) => Promise<number | null> = playedLength,
): Promise<PreparedSound | SoundProblem> {
  if (durationMs === undefined && !(file instanceof File && /\.(m4a|mp3)$/i.test(file.name)))
    return "unreadable";
  if (file.size === 0) return "unreadable";
  if (file.size > maxSoundBytes) return "tooLarge";
  const length = durationMs ?? (await lengthOf(file));
  if (length === null || !Number.isFinite(length) || length <= 0) return "unreadable";
  if (length > maxSoundMs) return "tooLarge";
  return { file, sha256: await sha256Of(file), durationMs: Math.max(1, Math.round(length)) };
}

/** How long the browser's player says [file] plays, in milliseconds; null where it cannot. */
function playedLength(file: Blob): Promise<number | null> {
  const url = URL.createObjectURL(file);
  const player = new Audio();
  return new Promise<number | null>((resolve) => {
    player.onloadedmetadata = () => {
      resolve(Number.isFinite(player.duration) ? player.duration * 1000 : null);
    };
    player.onerror = () => {
      resolve(null);
    };
    player.preload = "metadata";
    player.src = url;
  }).finally(() => {
    URL.revokeObjectURL(url);
  });
}
