"use server";

import { revalidatePath } from "next/cache";

import { parseDeckId } from "@/features/decks";

import { type ActionResult, call, refused } from "./action-call";

/**
 * Decides the open appeal on a note: [restore] undoes the AI's hide, otherwise the AI's decision
 * stands. The server checks the role and records the decision.
 */
export async function resolveTriageAppeal(deckId: string, restore: boolean): Promise<ActionResult> {
  const id = parseDeckId(deckId);
  if (id === null || typeof restore !== "boolean") return refused("malformed");
  const result = await call("admin_resolve_triage_appeal", { deck_id: id, restore });
  if ("failure" in result) return refused(result.failure);
  switch (result.data) {
    case "restored":
      revalidatePath("/admin", "layout");
      return { changed: true, message: "노트를 되돌려 놓았어요." };
    case "upheld":
      revalidatePath("/admin", "layout");
      return { changed: true, message: "AI가 한 처리를 그대로 두었어요." };
    case "not_restored":
      revalidatePath("/admin", "layout");
      return {
        changed: true,
        message: "이의 신청은 처리했지만 노트는 되돌리지 못했어요. 숨김이 이미 풀려 있어요.",
      };
    case "not_found":
      return { changed: false, message: "처리할 이의 신청이 없어요." };
    default:
      return refused("unreadable");
  }
}
