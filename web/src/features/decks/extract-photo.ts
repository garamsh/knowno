import { readPhoto } from "./actions";
import type { PhotoFailure } from "./photo-failure";
import type { Extraction } from "./read-photo";

import { downscalePhoto } from "@/design/prepare-photo";

/**
 * Prepares any chosen photo as the phone's `downscalePhoto` does (`@/design/prepare-photo`); a
 * file the browser cannot decode is `unreadable`, one too large even at the lowest quality
 * `refused`.
 */
export async function preparePhoto(file: Blob): Promise<File | PhotoFailure> {
  const prepared = await downscalePhoto(file);
  return typeof prepared === "string" ? { kind: prepared } : prepared;
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
