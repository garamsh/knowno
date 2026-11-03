"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, call, refused } from "./action-call";
import { parsePlanId } from "./read-admin";

/**
 * Applies [plan]'s draft to everyone (모두에게 적용): its users are served it from their next photo.
 * The server checks the role, refuses a draft whose provider has no key, and records it.
 */
export async function activateAiConfiguration(plan: string): Promise<ActionResult> {
  if (parsePlanId(plan) === null) return refused("malformed");
  const result = await call("admin_activate_ai_configuration", { plan });
  if ("failure" in result) return refused(result.failure);
  switch (result.data) {
    case "activated":
      revalidatePath("/admin", "layout");
      return { changed: true, message: "모든 사용자에게 적용했어요." };
    case "no_test":
      return { changed: false, message: "테스트 중인 설정이 없어요." };
    case "no_key":
      return { changed: false, message: "이 제공자의 키가 없어 적용할 수 없어요." };
    default:
      return refused("unreadable");
  }
}
