"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, failureMessages } from "./action-call";
import { maxNoteLength, maxPromptLength } from "./prompt-limits";

/** What the prompt form shows after an attempt that did not save. */
export type SavePromptState = { message: string | null };

/**
 * Saves the form's `text` as a new prompt version with its `note`, and opens it. Saving serves it
 * to no one: activating it, or making it the test version, is a separate action. The server checks
 * the role and the limits, and records the save.
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
  if (text.trim() === "" || codePoints(text) > maxPromptLength) {
    return { message: "프롬프트를 2만 자 안으로 적어 주세요." };
  }
  if (codePoints(note.trim()) > maxNoteLength)
    return { message: "메모는 200자 안으로 적어 주세요." };
  const result = await call("admin_save_prompt", { text, note: note.trim() });
  if ("failure" in result) return { message: failureMessages[result.failure] };
  if (typeof result.data !== "number" || !Number.isSafeInteger(result.data)) {
    return { message: failureMessages.unreadable };
  }
  revalidatePath("/admin", "layout");
  redirect(`/admin/ai/${String(result.data)}`);
}

/** [value]'s length in code points, as Postgres' `char_length` counts it. */
function codePoints(value: string): number {
  return value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "_").length;
}
