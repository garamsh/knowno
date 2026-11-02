"use server";

import { revalidatePath } from "next/cache";

import { parseDeckId } from "@/features/decks";

import { type ActionResult, call, refused } from "./action-call";

/**
 * Removes a public deck from sharing for good, with a reason: the deck becomes private and its
 * owner cannot publish it again (ADR 0072). The server checks the role and records it.
 */
export async function removeDeck(deckId: string, reason: string): Promise<ActionResult> {
  const id = parseDeckId(deckId);
  if (id === null || typeof reason !== "string") return refused("malformed");
  if (reason.trim() === "" || reason.trim().length > 500) {
    return { changed: false, message: "삭제하는 이유를 500자 안으로 적어 주세요." };
  }
  const result = await call("admin_remove_deck", { deck_id: id, reason: reason.trim() });
  if ("failure" in result) return refused(result.failure);
  if (typeof result.data !== "boolean") return refused("unreadable");
  if (result.data) revalidatePath("/admin", "layout");
  return {
    changed: result.data,
    message: result.data ? "공유에서 영구 삭제했어요." : "이미 공유에서 삭제된 노트예요.",
  };
}
