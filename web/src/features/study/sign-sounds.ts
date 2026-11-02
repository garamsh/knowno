import "server-only";

import { signMedia } from "@/features/decks";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";

/** How long a sound's signed address plays, in seconds: longer than a study session runs. */
export const soundUrlSeconds = 4 * 60 * 60;

/**
 * A signed address in the private `media` bucket for each of [media], the signed-in user's
 * sounds, each at `{owner}/{media id}` (ADR 0107, ADR 0112), in one request through `decks`'
 * media path (ADR 0159). A sound the bucket cannot sign, and every sound when the request fails,
 * has none, so its control says it cannot play rather than the page failing.
 */
export async function signSounds(media: string[]): Promise<Map<string, string>> {
  if (media.length === 0) return new Map();
  const supabase = await createClient();
  const session = await readUserId(supabase);
  if ("failure" in session) return new Map();
  return signMedia(supabase, session.userId, media, soundUrlSeconds);
}
