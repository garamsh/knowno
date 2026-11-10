"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, call, refused } from "./action-call";

/** Lifts the pause the undo rate set, so the AI acts again while its mode is on. */
export async function resumeTriage(): Promise<ActionResult> {
  const result = await call("admin_resume_triage");
  if ("failure" in result) return refused(result.failure);
  if (typeof result.data !== "boolean") return refused("unreadable");
  if (result.data) revalidatePath("/admin", "layout");
  return {
    changed: result.data,
    message: result.data ? "다시 켰어요." : "멈춘 상태가 아니에요.",
  };
}
