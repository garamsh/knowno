"use server";

import { redirect } from "next/navigation";

import { env } from "@/env";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";

/** What the deletion dialog shows after a failed attempt. */
export type DeleteAccountState = { error: string | null };

/** The function deletes the user's files first, so it may take longer than a read. */
const deleteTimeoutMs = 60_000;
const rejected = "계정을 삭제하지 못했어요. 다시 시도해 주세요.";
const unreachable = "계정을 삭제하지 못했어요. 연결을 확인하고 다시 시도해 주세요.";

/**
 * Deletes the signed-in user's account through the `delete-account` Edge Function with the
 * session's access token and no body, as the phone does. Then ends this browser's session and
 * opens `/login` saying so; a failure keeps the session and returns its sentence. The web sends no
 * Apple authorization code, so an Apple account's authorization is not revoked (ADR 0247).
 */
export async function deleteAccount(): Promise<DeleteAccountState> {
  const client = await createClient();
  if ("failure" in (await readUserId(client))) return { error: rejected };
  const token = (await client.auth.getSession()).data.session?.access_token;
  if (!token) return { error: rejected };
  let response: Response;
  try {
    response = await fetch(`${env.supabaseUrl.replace(/\/$/u, "")}/functions/v1/delete-account`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: env.supabasePublishableKey },
      signal: AbortSignal.timeout(deleteTimeoutMs),
    });
  } catch {
    return { error: unreachable };
  }
  if (response.status !== 204) return { error: response.status >= 500 ? unreachable : rejected };
  // The account is gone: a session that cannot be ended here belongs to no user.
  await client.auth.signOut({ scope: "local" });
  redirect("/login?deleted=1");
}
