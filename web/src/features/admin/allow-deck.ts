"use server";

import { type ActionResult, deckOutcomeAction } from "./action-call";

/**
 * Lets a held note become public, as the content the admin read: the server answers `changed`
 * when the owner edited it since, so what the admin allowed is what was read.
 */
export async function allowDeck(deckId: string, contentHash: string): Promise<ActionResult> {
  return deckOutcomeAction(
    "admin_allow_deck",
    deckId,
    { content_hash: contentHash },
    {
      allowed: { changed: true, message: "노트를 공개했어요." },
      not_held: { changed: false, message: "이미 처리된 노트예요." },
      changed: { changed: false, message: "노트가 바뀌었어요. 새로 고쳐서 다시 확인해 주세요." },
    },
  );
}
