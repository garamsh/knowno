"use server";

import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";

import { parseImage, parseMediaId, parseSound, releaseUnheld, storeFile } from "./media";

const notStored = "카드를 저장하지 못했어요. 다시 시도해 주세요.";

/**
 * Stores one file a card's new 사진 or 소리 names, before the card is written (ADR 0163): [form]
 * holds `media`, the id the editor gave it, `kind`, `image` or `audio`, the `file` and its
 * `sha256`. A photo is a JPEG the browser prepared, a sound an MP4 or MP3 of up to 5 MiB. Its
 * `media` row goes first, then its object, as `media.ts` stores every file; a store that fails
 * releases what it left. A file already stored under the id counts as stored, so a retry succeeds.
 */
export async function storeCardMedia(
  form: FormData,
): Promise<{ stored: true } | { stored: false; message: string }> {
  const media = parseMediaId(form.get("media"));
  const kind = form.get("kind");
  const file =
    kind === "image"
      ? await parseImage(form.get("file"), form.get("sha256"))
      : kind === "audio"
        ? await parseSound(form.get("file"), form.get("sha256"))
        : null;
  if (!media || !file) return { stored: false, message: notStored };
  const client = await createClient();
  const session = await readUserId(client);
  if ("failure" in session) return { stored: false, message: "다시 로그인해 주세요" };
  if (await storeFile(client, session.userId, media, file)) return { stored: true };
  await releaseUnheld(client, session.userId, [media]);
  return { stored: false, message: notStored };
}
