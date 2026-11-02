"use server";

import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";
import { selectAll } from "@/supabase/select-all";
import { requestTimeoutMs } from "@/supabase/failure";
import { field } from "@/supabase/row";
import { parseDeckId } from "./library";

/**
 * The card keys the signed-in user's deck [deckId] holds, which the photo review list marks
 * "이미 노트에 있어요"; null when the deck or the session cannot be read.
 */
export async function readCardKeys(deckId: string): Promise<string[] | null> {
  if (!parseDeckId(deckId)) return null;
  const client = await createClient();
  const session = await readUserId(client);
  if ("failure" in session) return null;
  const rows = await selectAll((from, to, counted) =>
    client
      .from("cards")
      .select("card_key", counted ? { count: "exact" } : {})
      .eq("deck_id", deckId)
      .eq("user_id", session.userId)
      .is("deleted_at", null)
      .order("id")
      .range(from, to)
      .abortSignal(AbortSignal.timeout(requestTimeoutMs)),
  );
  if ("failure" in rows) return null;
  return rows.rows.flatMap((row) => {
    const key = field(row, "card_key");
    return typeof key === "string" ? [key] : [];
  });
}
