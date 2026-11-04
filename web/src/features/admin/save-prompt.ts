"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, failureMessages } from "./action-call";
import { promptRefusal } from "./prompt-limits";

/** What the prompt form shows after an attempt that did not save. */
export type SavePromptState = { message: string | null };

/**
 * Saves the form's `text` as a new prompt version with its `note`, and returns to AI. Saving serves
 * it to no one: a plan's draft names it, and applying the draft sends it. The server checks the
 * role and the limits, and records the save.
 */
export async function savePrompt(
  _previous: SavePromptState,
  form: FormData,
): Promise<SavePromptState> {
  const text = form.get("text");
  const note = form.get("note");
  if (typeof text !== "string" || typeof note !== "string") {
    return { message: failureMessages.malformed };
  }
  const refusal = promptRefusal(text, note);
  if (refusal !== null) return { message: refusal };
  const result = await call("admin_save_prompt", { text, note: note.trim() });
  if ("failure" in result) return { message: failureMessages[result.failure] };
  if (typeof result.data !== "number" || !Number.isSafeInteger(result.data)) {
    return { message: failureMessages.unreadable };
  }
  revalidatePath("/admin", "layout");
  redirect("/ai");
}
