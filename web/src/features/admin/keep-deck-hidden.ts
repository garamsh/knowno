"use server";

import { type ActionResult, deckOutcomeAction, refused } from "./action-call";

/**
 * Keeps a held note off the public list for good, as the content the admin read, with the reason
 * the audit log records; the owner sees only that an admin decided.
 */
export async function keepDeckHidden(
  deckId: string,
  contentHash: string,
  reason: string,
): Promise<ActionResult> {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (trimmed === "") return { changed: false, message: "이유를 적어 주세요." };
  if (typeof contentHash !== "string") return refused("malformed");
  return deckOutcomeAction(
    "admin_keep_deck_hidden",
    deckId,
    { content_hash: contentHash, reason: trimmed.slice(0, 500) },
    {
      kept: { changed: true, message: "노트를 숨김으로 유지했어요." },
      not_held: { changed: false, message: "이미 처리된 노트예요." },
      changed: { changed: false, message: "노트가 바뀌었어요. 새로 고쳐서 다시 확인해 주세요." },
    },
  );
}
