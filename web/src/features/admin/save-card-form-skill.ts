"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { call, failureMessages } from "./action-call";
import { parseCardForm } from "./labels";
import { skillRefusal } from "./skill-limits";

/** What the skill form shows after an attempt that did not save. */
export type SaveSkillState = { message: string | null };

/**
 * Saves the form's `summary`, `text` and `note` as a new version of [form]'s skill and makes it the
 * form's draft, tried by admins until it is applied or ended, then returns to its panel in 말랑이.
 * The server checks the role and the limits, and records the save.
 */
export async function saveCardFormSkill(
  form: string,
  _previous: SaveSkillState,
  data: FormData,
): Promise<SaveSkillState> {
  const known = parseCardForm(form);
  const summary = data.get("summary");
  const text = data.get("text");
  const note = data.get("note");
  if (
    known === null ||
    typeof summary !== "string" ||
    typeof text !== "string" ||
    typeof note !== "string"
  ) {
    return { message: failureMessages.malformed };
  }
  // A browser submits a textarea's line breaks as CRLF, which would make every line a change.
  const guide = text.replace(/\r\n?/g, "\n");
  const refusal = skillRefusal(summary, guide, note);
  if (refusal !== null) return { message: refusal };
  const result = await call("admin_save_card_form_skill", {
    form: known,
    summary: summary.trim(),
    text: guide,
    note: note.trim(),
  });
  if ("failure" in result) return { message: failureMessages[result.failure] };
  if (typeof result.data !== "number" || !Number.isSafeInteger(result.data)) {
    return { message: failureMessages.unreadable };
  }
  revalidatePath("/admin", "layout");
  redirect(`/assistant?${new URLSearchParams({ skill: known }).toString()}`);
}
