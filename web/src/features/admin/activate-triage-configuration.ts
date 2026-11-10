"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, call, refused } from "./action-call";

/**
 * Applies the triage's draft: the AI judges with it from the next note. The server checks the
 * role, refuses a draft whose provider has no key, and records it.
 */
export async function activateTriageConfiguration(): Promise<ActionResult> {
  const result = await call("admin_activate_triage_configuration");
  if ("failure" in result) return refused(result.failure);
  switch (result.data) {
    case "activated":
      revalidatePath("/admin", "layout");
      return { changed: true, message: "신고 AI에 적용했어요." };
    case "no_test":
      return { changed: false, message: "테스트 중인 구성이 없어요." };
    case "no_key":
      return { changed: false, message: "이 제공자의 키가 없어 적용할 수 없어요." };
    default:
      return refused("unreadable");
  }
}
