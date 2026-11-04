"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, failureMessages } from "./action-call";
import { promptRefusal } from "./prompt-limits";
import type { SavePromptState } from "./save-prompt";

/**
 * Saves the form's `text` as a new assistant prompt with its `note`, and returns to 말랑이. Saving
 * serves it to no one: a plan's assistant draft names it, and applying the draft sends it. The
 * server checks the role and the limits, and records the save.
 */
export async function saveAssistantPrompt(
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
  const result = await call("admin_save_assistant_prompt", { text, note: note.trim() });
  if ("failure" in result) return { message: failureMessages[result.failure] };
  if (typeof result.data !== "number" || !Number.isSafeInteger(result.data)) {
    return { message: failureMessages.unreadable };
  }
  revalidatePath("/admin", "layout");
  redirect("/assistant");
}
