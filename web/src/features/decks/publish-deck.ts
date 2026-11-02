"use server";

import { revalidatePath } from "next/cache";

import { requestTimeoutMs } from "@/supabase/failure";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";

import { parseDeckId } from "./library";
import { characters, maxDescriptionLength, parseDisplayName } from "./publishing";

type Outcome = { saved: true } | { saved: false; message: string };

/** The phone's `sharingFailed`, for a write the server refused or left unanswered. */
const failed = "지금은 처리할 수 없어요. 잠시 후 다시 시도해 주세요.";
const gone = "이 노트는 삭제됐어요. 다른 노트를 골라 주세요.";

/**
 * Publishes the signed-in user's live deck [id] with [description], trimmed, none when empty,
 * at most 300 characters, as the phone's publish sheet does; first stores [name] as the user's
 * display name, 2 to 20 characters, when the user has none yet and gave one.
 */
export async function publishDeck(
  id: string,
  description: string,
  name?: string,
): Promise<Outcome> {
  const deckId = parseDeckId(id);
  const text = typeof description === "string" ? description.trim() : null;
  const displayName = name === undefined ? undefined : parseDisplayName(name);
  if (!deckId || text === null || characters(text) > maxDescriptionLength || displayName === null)
    return { saved: false, message: failed };
  const client = await createClient();
  const session = await readUserId(client);
  if ("failure" in session) return { saved: false, message: "다시 로그인해 주세요" };
  if (displayName !== undefined) {
    // user_id is the caller by the column's default, as the phone writes it.
    const profile = await client
      .from("profiles")
      .upsert({ display_name: displayName }, { onConflict: "user_id" })
      .abortSignal(AbortSignal.timeout(requestTimeoutMs));
    if (profile.error) return { saved: false, message: failed };
  }
  const now = new Date().toISOString();
  return writeVisibility(client, deckId, session.userId, {
    visibility: "public",
    published_at: now,
    description: text || null,
    updated_at: now,
  });
}

/** Makes the signed-in user's live deck [id] private again, keeping its description. */
export async function unpublishDeck(id: string): Promise<Outcome> {
  const deckId = parseDeckId(id);
  if (!deckId) return { saved: false, message: failed };
  const client = await createClient();
  const session = await readUserId(client);
  if ("failure" in session) return { saved: false, message: "다시 로그인해 주세요" };
  return writeVisibility(client, deckId, session.userId, {
    visibility: "private",
    published_at: null,
    updated_at: new Date().toISOString(),
  });
}

async function writeVisibility(
  client: Awaited<ReturnType<typeof createClient>>,
  deckId: string,
  userId: string,
  columns: Record<string, string | null>,
): Promise<Outcome> {
  const write = await client
    .from("decks")
    .update(columns)
    .eq("id", deckId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id")
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (write.error) return { saved: false, message: failed };
  if (write.data.length === 0) return { saved: false, message: gone };
  revalidatePath("/", "layout");
  return { saved: true };
}
