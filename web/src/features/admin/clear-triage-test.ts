"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, call, refused } from "./action-call";

/** Ends the triage's draft, so only its active configuration is left. */
export async function clearTriageTest(): Promise<ActionResult> {
  const result = await call("admin_clear_triage_test");
  if ("failure" in result) return refused(result.failure);
  if (typeof result.data !== "boolean") return refused("unreadable");
  if (result.data) revalidatePath("/admin", "layout");
  return {
    changed: result.data,
    message: result.data ? "테스트를 끝냈어요." : "테스트 중인 구성이 없어요.",
  };
}
