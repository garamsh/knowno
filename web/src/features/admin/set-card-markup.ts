"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, call, refused } from "./action-call";

/**
 * Turns the card markup switch on or off (ADR 0216): the card tools write `text` version 3 and
 * `cloze` version 2 while it is on, and the skills that teach them are served. The server checks
 * the role, answers `unchanged` for the value it has, and records the change.
 */
export async function setCardMarkup(enabled: boolean): Promise<ActionResult> {
  // The argument crossed the network, whatever its declared type.
  if (typeof enabled !== "boolean") return refused("malformed");
  const result = await call("admin_set_card_markup", { enabled });
  if ("failure" in result) return refused(result.failure);
  switch (result.data) {
    case "set":
      revalidatePath("/admin", "layout");
      return {
        changed: true,
        message: enabled
          ? "마크업을 켰어요. 다음 카드부터 새 형식으로 써요."
          : "마크업을 껐어요. 이미 쓴 카드는 그대로예요.",
      };
    case "unchanged":
      return { changed: false, message: enabled ? "이미 켜져 있어요." : "이미 꺼져 있어요." };
    default:
      // `bad_value` cannot come from a boolean, so it is read as a refusal, as any other answer is.
      return refused("unreadable");
  }
}
