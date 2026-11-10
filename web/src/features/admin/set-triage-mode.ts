"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, call, refused } from "./action-call";
import { parseTriageMode } from "./triage-input";

/**
 * Sets the AI's mode: `acting` lets it hide or dismiss within the threshold, anything else leaves
 * it judging and changing nothing (ADR 0244). The server checks the role and records the change.
 */
export async function setTriageMode(mode: string): Promise<ActionResult> {
  const chosen = parseTriageMode(mode);
  const result = await call("admin_set_triage_settings", { mode: chosen });
  if ("failure" in result) return refused(result.failure);
  if (result.data !== true) return refused("unreadable");
  revalidatePath("/admin", "layout");
  return {
    changed: true,
    message:
      chosen === "acting"
        ? "이제 AI가 직접 처리해요. 처리한 것은 모두 되돌릴 수 있어요."
        : "이제 AI는 판단만 하고 아무것도 바꾸지 않아요.",
  };
}
