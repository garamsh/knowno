import "server-only";

import { requestTimeoutMs } from "@/supabase/failure";
import { field } from "@/supabase/row";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";

/**
 * The signed-in user's display name, which the publish sheet asks for while there is none, as
 * the phone's reads it; `unread` when it could not be read, so the sheet offers "다시 시도".
 */
export async function readDisplayName(): Promise<{ name: string | null } | "unread"> {
  const client = await createClient();
  const session = await readUserId(client);
  if ("failure" in session) return "unread";
  const read = await client
    .from("profiles")
    .select("display_name")
    .eq("user_id", session.userId)
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (read.error) return "unread";
  const name = field(read.data[0], "display_name");
  return { name: typeof name === "string" ? name : null };
}
