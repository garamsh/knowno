import "server-only";

import { requestTimeoutMs } from "@/supabase/failure";
import { field } from "@/supabase/row";
import { createClient } from "@/supabase/server";

import type { DeckId } from "./library";
import { refusalSentence } from "./refusal";

/** Why the signed-in user's refused note [deckId] was refused, in one sentence; none where it cannot be read. */
export async function readRefusal(deckId: DeckId): Promise<string | null> {
  const client = await createClient();
  const result = await client
    .rpc("my_deck_screening", { deck_id: deckId })
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (result.error || field(result.data, "state") !== "refused") return null;
  return refusalSentence(field(result.data, "refusal"), field(result.data, "findings"));
}
