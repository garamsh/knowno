"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, call, refused } from "./action-call";
import { parseCardForm } from "./labels";

/** Ends [form]'s skill draft, so admins are served its active version again. */
export async function clearCardFormSkillTest(form: string): Promise<ActionResult> {
  const known = parseCardForm(form);
  if (known === null) return refused("malformed");
  const result = await call("admin_clear_card_form_skill_test", { form: known });
  if ("failure" in result) return refused(result.failure);
  if (typeof result.data !== "boolean") return refused("unreadable");
  if (result.data) revalidatePath("/admin", "layout");
  return {
    changed: result.data,
    message: result.data
      ? "테스트를 끝냈어요. 관리자도 사용 중인 스킬을 써요."
      : "테스트 중인 스킬이 없어요.",
  };
}
