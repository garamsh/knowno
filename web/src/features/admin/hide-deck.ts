"use server";

import { type ActionResult, deckAction } from "./action-call";

/** Hides a deck from the public listing; the server checks the caller's role and records it. */
export async function hideDeck(deckId: string): Promise<ActionResult> {
  return deckAction("admin_set_deck_hidden", deckId, { hidden: true }, (changed) =>
    changed ? "노트를 숨겼어요." : "이미 숨겨진 노트예요.",
  );
}
