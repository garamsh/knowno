"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, call, refused } from "./action-call";
import { parseCardForm } from "./labels";

/**
 * Applies [form]'s skill draft to everyone (모두에게 적용): the assistant and MCP serve it from
 * their next read of the skills. The server checks the role and records it.
 */
export async function activateCardFormSkill(form: string): Promise<ActionResult> {
  const known = parseCardForm(form);
  if (known === null) return refused("malformed");
  const result = await call("admin_activate_card_form_skill", { form: known });
  if ("failure" in result) return refused(result.failure);
  switch (result.data) {
    case "activated":
      revalidatePath("/admin", "layout");
      return { changed: true, message: "모든 사용자에게 적용했어요." };
    case "no_test":
      return { changed: false, message: "테스트 중인 스킬이 없어요." };
    default:
      return refused("unreadable");
  }
}
