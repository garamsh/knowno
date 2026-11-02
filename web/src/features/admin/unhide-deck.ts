"use server";

import { type ActionResult, deckAction } from "./action-call";

/** Shows a hidden deck in the public listing again. */
export async function unhideDeck(deckId: string): Promise<ActionResult> {
  return deckAction("admin_set_deck_hidden", deckId, { hidden: false }, (changed) =>
    changed ? "숨김을 풀었어요." : "숨겨지지 않은 노트예요.",
  );
}
