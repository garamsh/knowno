"use server";

import { type ActionResult, deckAction } from "./action-call";

/** Makes a public deck private; the owner's devices pull the change. */
export async function unpublishDeck(deckId: string): Promise<ActionResult> {
  return deckAction("admin_unpublish_deck", deckId, {}, (changed) =>
    changed ? "비공개로 바꿨어요." : "이미 비공개인 노트예요.",
  );
}
