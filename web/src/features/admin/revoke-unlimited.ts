"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, call, parseUserId, refused } from "./action-call";

/** Removes a user's 무제한 grant, leaving the user on its plan. */
export async function revokeUnlimited(userId: string): Promise<ActionResult> {
  const id = parseUserId(userId);
  if (id === null) return refused("malformed");
  const result = await call("admin_revoke_unlimited", { user_id: id });
  if ("failure" in result) return refused(result.failure);
  if (typeof result.data !== "boolean") return refused("unreadable");
  if (result.data) revalidatePath("/admin", "layout");
  return {
    changed: result.data,
    message: result.data ? "무제한을 해제했어요." : "이미 무제한이 아니에요.",
  };
}
