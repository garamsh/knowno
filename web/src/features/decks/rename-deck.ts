"use server";

import { revalidatePath } from "next/cache";

import { requestTimeoutMs } from "@/supabase/failure";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";

import { parseDeckId } from "./library";

/** Renames the signed-in user's live deck [id] to [name], trimmed, 1 to 500 characters. */
export async function renameDeck(
  id: string,
  name: string,
): Promise<{ saved: true } | { saved: false; message: string }> {
  const deckId = parseDeckId(id);
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed || trimmed.length > 500) return { saved: false, message: "이름을 입력해 주세요" };
  if (!deckId) return { saved: false, message: "이 노트는 삭제됐어요. 다른 노트를 골라 주세요." };
  const client = await createClient();
  const session = await readUserId(client);
  if ("failure" in session) return { saved: false, message: "다시 로그인해 주세요" };
  const write = await client
    .from("decks")
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq("id", deckId)
    .eq("user_id", session.userId)
    .is("deleted_at", null)
    .select("id")
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (write.error) return { saved: false, message: "이름을 바꾸지 못했어요. 다시 시도해 주세요." };
  if (write.data.length === 0)
    return { saved: false, message: "이 노트는 삭제됐어요. 다른 노트를 골라 주세요." };
  revalidatePath("/", "layout");
  return { saved: true };
}
