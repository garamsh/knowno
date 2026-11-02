"use server";

import { revalidatePath } from "next/cache";

import { requestTimeoutMs } from "@/supabase/failure";
import { field } from "@/supabase/row";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";

import { parseCardContent } from "./card-content";
import { parseDeckId } from "./library";
import { type MediaId, parseMediaId, releaseUnheld } from "./media";

/**
 * Deletes the signed-in user's live deck [id] and its live cards as the clients do (ADR 0149):
 * each a tombstone of `deleted_at` and `updated_at` at one time, the cards first, so a failure
 * between the two leaves the deck to delete again. Then it releases the deck's photo and its
 * cards' photos and sounds that no live deck or card of the user's holds; a release that fails
 * leaves the deletion standing.
 */
export async function deleteDeck(
  id: string,
): Promise<{ deleted: true } | { deleted: false; message: string }> {
  const deckId = parseDeckId(id);
  if (!deckId) return { deleted: false, message: "이 노트는 삭제됐어요. 다른 노트를 골라 주세요." };
  const client = await createClient();
  const session = await readUserId(client);
  if ("failure" in session) return { deleted: false, message: "다시 로그인해 주세요" };
  const { userId } = session;
  const now = new Date().toISOString();
  const tombstone = { deleted_at: now, updated_at: now };
  const cards = await client
    .from("cards")
    .update(tombstone)
    .eq("deck_id", deckId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("front, back, template, template_version")
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (cards.error)
    return { deleted: false, message: "노트를 삭제하지 못했어요. 다시 시도해 주세요." };
  const deck = await client
    .from("decks")
    .update(tombstone)
    .eq("id", deckId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("image_media_id")
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (deck.error)
    return { deleted: false, message: "노트를 삭제하지 못했어요. 다시 시도해 주세요." };
  revalidatePath("/", "layout");
  if (deck.data.length === 0)
    return { deleted: false, message: "이 노트는 삭제됐어요. 다른 노트를 골라 주세요." };

  const media: MediaId[] = [];
  const image = parseMediaId(field(deck.data[0], "image_media_id"));
  if (image) media.push(image);
  for (const row of cards.data) {
    const content = parseCardContent({
      front: field(row, "front"),
      back: field(row, "back"),
      template: field(row, "template"),
      templateVersion: field(row, "template_version"),
    });
    // A card this build cannot read names no file it can find, as on the phone.
    for (const block of content ? [...content.front, ...content.back] : []) {
      const named =
        block.kind === "image" || block.kind === "audio" ? parseMediaId(block.media) : null;
      if (named) media.push(named);
    }
  }
  const kept = await releaseUnheld(client, userId, media);
  if (kept.length > 0) console.error(`deleteDeck: media not released: ${kept.join(",")}`);
  return { deleted: true };
}
