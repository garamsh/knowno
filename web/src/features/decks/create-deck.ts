"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";
import { requestTimeoutMs } from "@/supabase/failure";
import { field } from "@/supabase/row";
import { parseDeckId } from "./library";

/** Creation never overwrites a row; a retry keeps its original id. */
export async function createDeck(
  id: string,
  name: string,
): Promise<{ saved: true; deckId: string } | { saved: false; message: string }> {
  if (!parseDeckId(id) || typeof name !== "string" || !name.trim() || name.length > 500)
    return { saved: false, message: "이름을 입력해 주세요" };
  const client = await createClient();
  const session = await readUserId(client);
  if ("failure" in session) return { saved: false, message: "다시 로그인해 주세요" };
  const now = new Date().toISOString();
  const write = await client
    .from("decks")
    .upsert(
      {
        id,
        user_id: session.userId,
        name: name.trim(),
        visibility: "private",
        created_at: now,
        updated_at: now,
      },
      { onConflict: "id", ignoreDuplicates: true },
    )
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (write.error) return { saved: false, message: "노트를 만들지 못했어요. 다시 시도해 주세요." };
  const read = await client
    .from("decks")
    .select("id,name")
    .eq("id", id)
    .eq("user_id", session.userId)
    .is("deleted_at", null)
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (
    read.error ||
    !Array.isArray(read.data) ||
    !read.data.some((row: unknown) => field(row, "name") === name.trim())
  )
    return { saved: false, message: "노트를 만들지 못했어요. 다시 시도해 주세요." };
  revalidatePath("/", "layout");
  return { saved: true, deckId: id };
}
