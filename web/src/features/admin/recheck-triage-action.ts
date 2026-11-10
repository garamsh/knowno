"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, call, refused } from "./action-call";
import { parseActionId } from "./triage-input";

/** Records whether the admin [agreed] with a sampled AI action after looking at it again. */
export async function recheckTriageAction(
  actionId: number,
  agreed: boolean,
): Promise<ActionResult> {
  const id = parseActionId(actionId);
  if (id === null || typeof agreed !== "boolean") return refused("malformed");
  const result = await call("admin_recheck_triage_action", { action_id: id, agreed });
  if ("failure" in result) return refused(result.failure);
  switch (result.data) {
    case "rechecked":
      revalidatePath("/admin", "layout");
      return { changed: true, message: "확인한 결과를 남겼어요." };
    case "already":
      return { changed: false, message: "이미 확인한 기록이에요." };
    case "not_sampled":
      return { changed: false, message: "다시 확인 대상이 아닌 기록이에요." };
    case "not_found":
      return { changed: false, message: "찾을 수 없는 기록이에요." };
    default:
      return refused("unreadable");
  }
}
