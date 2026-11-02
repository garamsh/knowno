"use server";

import { revalidatePath } from "next/cache";
import { v7 } from "uuid";

import { requestTimeoutMs } from "@/supabase/failure";
import { field } from "@/supabase/row";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";

import { parseDeckIcon } from "./deck-icon";
import { deckColors } from "./deck-tint";
import { parseDeckId } from "./library";
import { type MediaId, parseImage, parseMediaId, releaseUnheld, storeImage } from "./media";

const gone = "이 노트는 삭제됐어요. 다른 노트를 골라 주세요.";
const failed = "노트를 꾸미지 못했어요. 다시 시도해 주세요.";
/** An upload refused or unanswered: nothing was written, so the note keeps its photo. */
const notStored = "사진을 저장하지 못했어요. 노트는 그대로예요. 다시 시도해 주세요.";

/**
 * Stores 노트 꾸미기's choice on the signed-in user's live deck, as the phone's sheet does
 * (ADR 0159): [form] holds `deck`, `icon`, a key of the app's icons, `color`, a key of the
 * palette or empty for none, and `image`: `keep`, `remove`, or a prepared JPEG with its `sha256`.
 * A new photo is stored first, its `media` row then its file, and only then is the deck written,
 * so a failed upload leaves the deck and its photo as they were; the photo it replaces, or
 * removes, is released after, unless another live deck or card holds it.
 */
export async function decorateDeck(
  form: FormData,
): Promise<{ saved: true } | { saved: false; message: string }> {
  const deckId = parseDeckId(form.get("deck"));
  const icon = parseDeckIcon(form.get("icon"));
  const colorKey = form.get("color");
  const color = deckColors.find((key) => key === colorKey) ?? null;
  const choice = form.get("image");
  if (!deckId || !icon || (colorKey !== "" && !color)) return { saved: false, message: failed };
  const image =
    choice === "keep" || choice === "remove"
      ? choice
      : await parseImage(choice, form.get("sha256"));
  if (!image) return { saved: false, message: notStored };
  const client = await createClient();
  const session = await readUserId(client);
  if ("failure" in session) return { saved: false, message: "다시 로그인해 주세요" };
  const { userId } = session;
  const stored = await client
    .from("decks")
    .select("image_media_id")
    .eq("id", deckId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (stored.error) return { saved: false, message: failed };
  if (stored.data.length === 0) return { saved: false, message: gone };
  const previous = parseMediaId(field(stored.data[0], "image_media_id"));

  let next = previous;
  if (image === "remove") next = null;
  else if (image !== "keep") {
    next = v7() as MediaId;
    if (!(await storeImage(client, userId, next, image))) {
      await releaseUnheld(client, userId, [next]);
      return { saved: false, message: notStored };
    }
  }
  const write = await client
    .from("decks")
    .update({ icon, color, image_media_id: next, updated_at: new Date().toISOString() })
    .eq("id", deckId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id")
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (write.error || write.data.length === 0) {
    // The new file is held by nothing now, so it goes as it came.
    if (next && next !== previous) await releaseUnheld(client, userId, [next]);
    return { saved: false, message: write.error ? failed : gone };
  }
  if (previous && previous !== next) {
    const kept = await releaseUnheld(client, userId, [previous]);
    if (kept.length > 0) console.error(`decorateDeck: media not released: ${kept.join(",")}`);
  }
  revalidatePath("/", "layout");
  return { saved: true };
}
