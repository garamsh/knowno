"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, call, refused } from "./action-call";
import { parseActionId } from "./triage-input";

/**
 * Undoes what the AI did to a note: it unhides a note it hid, or restores the reports it
 * dismissed. The server checks the role and records the undo.
 */
export async function undoTriageAction(actionId: number): Promise<ActionResult> {
  const id = parseActionId(actionId);
  if (id === null) return refused("malformed");
  const result = await call("admin_undo_triage_action", { action_id: id });
  if ("failure" in result) return refused(result.failure);
  switch (result.data) {
    case "undone":
      revalidatePath("/admin", "layout");
      return { changed: true, message: "되돌렸어요." };
    case "already":
      return { changed: false, message: "이미 되돌렸어요." };
    case "superseded":
      return { changed: false, message: "숨김이 이미 풀려 있어 바뀐 것이 없어요." };
    case "not_found":
      return { changed: false, message: "찾을 수 없는 기록이에요." };
    default:
      return refused("unreadable");
  }
}
