import "server-only";

import { requestTimeoutMs } from "@/supabase/failure";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";

import { isUuid } from "./uuid";

/**
 * The note [value] names, an address's `note`, when it is the signed-in user's live note: its id
 * and name, which the chat names as where it was opened from. Null for an id that is none, a note
 * that is not the user's or was deleted, and a read that failed: the chat then opens from nowhere.
 */
export async function readNote(value: unknown): Promise<{ id: string; name: string } | null> {
  if (typeof value !== "string" || !isUuid(value)) return null;
  const id = value;
  const supabase = await createClient();
  const session = await readUserId(supabase);
  if ("failure" in session) return null;
  const read = await supabase
    .from("decks")
    .select("id, name")
    .eq("id", id)
    .eq("user_id", session.userId)
    .is("deleted_at", null)
    .abortSignal(AbortSignal.timeout(requestTimeoutMs))
    .maybeSingle();
  const row: unknown = read.data;
  if (read.error || typeof row !== "object" || row === null) return null;
  const name: unknown = "name" in row ? row.name : undefined;
  return typeof name === "string" ? { id, name } : null;
}
