"use server";

import { revalidatePath } from "next/cache";

import { type ActionResult, call, refused } from "./action-call";
import { readScreeningTerms } from "./read-screening";
import { screeningWords } from "./screening-words";

/** The longest a term is, as the server keeps it. */
const longest = 100;

/** Adds [term] to the banned words; one already there is not added twice. */
export async function addScreeningTerm(term: string): Promise<ActionResult> {
  const trimmed = typeof term === "string" ? term.trim() : "";
  if (trimmed === "") return { changed: false, message: "금칙어를 입력해 주세요." };
  if (Array.from(trimmed).length > longest) {
    return { changed: false, message: `금칙어는 ${String(longest)}자까지 쓸 수 있어요.` };
  }
  const result = await call("admin_add_screening_term", { term: trimmed });
  if ("failure" in result) return refused(result.failure);
  if (typeof result.data !== "number") return refused("unreadable");
  revalidatePath("/admin", "layout");
  return { changed: true, message: "금칙어를 추가했어요." };
}

/** Removes the banned word [id]. */
export async function removeScreeningTerm(id: number): Promise<ActionResult> {
  if (!Number.isSafeInteger(id) || id < 1) return refused("malformed");
  const result = await call("admin_remove_screening_term", { id });
  if ("failure" in result) return refused(result.failure);
  if (typeof result.data !== "boolean") return refused("unreadable");
  if (!result.data) return { changed: false, message: "이미 지워진 금칙어예요." };
  revalidatePath("/admin", "layout");
  return { changed: true, message: "금칙어를 지웠어요." };
}

/**
 * Adds each word of the bundled list (`screening-words.ts`) the banned words lack, one
 * `admin_add_screening_term` call each. Nothing calls it but this action, so no build or deploy
 * loads the list.
 */
export async function importScreeningWords(): Promise<ActionResult> {
  const read = await readScreeningTerms();
  if ("failure" in read) return refused(read.failure);
  const have = new Set(read.data.map((term) => term.term.normalize("NFKC")));
  const missing = screeningWords.filter((word) => !have.has(word.normalize("NFKC")));
  let added = 0;
  for (const word of missing) {
    const result = await call("admin_add_screening_term", { term: word });
    if ("failure" in result || typeof result.data !== "number") {
      if (added > 0) revalidatePath("/admin", "layout");
      const why = "failure" in result ? result.failure : "unreadable";
      return {
        changed: added > 0,
        message: `${String(added)}개를 추가하고 멈췄어요. ${refused(why).message}`,
      };
    }
    added += 1;
  }
  if (added === 0) return { changed: false, message: "목록의 금칙어가 이미 모두 들어 있어요." };
  revalidatePath("/admin", "layout");
  return { changed: true, message: `금칙어 ${String(added)}개를 추가했어요.` };
}
