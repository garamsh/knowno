"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, call, refused } from "./action-call";
import { parsePlanId } from "./read-admin";

/** Ends [plan]'s draft, so admins are served its active configuration again. */
export async function clearAiTest(plan: string): Promise<ActionResult> {
  if (parsePlanId(plan) === null) return refused("malformed");
  const result = await call("admin_clear_ai_test", { plan });
  if ("failure" in result) return refused(result.failure);
  if (typeof result.data !== "boolean") return refused("unreadable");
  if (result.data) revalidatePath("/admin", "layout");
  return {
    changed: result.data,
    message: result.data
      ? "테스트를 끝냈어요. 관리자도 사용 중인 설정을 써요."
      : "테스트 중인 설정이 없어요.",
  };
}
