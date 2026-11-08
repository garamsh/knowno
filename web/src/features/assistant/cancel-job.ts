"use server";

import { env } from "@/env";

import { isJobId, jobTimeoutMs } from "./forward-job";
import { assistantUrl, readUserToken } from "./forward-message";

/**
 * Cancels the photo job [id], as the verified user, through the function (`assistant.md` §Photo
 * jobs); whether it is cancelled. The id crossed the network, so it is read before it is sent.
 */
export async function cancelPhotoJob(id: unknown): Promise<boolean> {
  if (typeof id !== "string" || !isJobId(id)) return false;
  const session = await readUserToken();
  if ("status" in session) return false;
  try {
    const response = await fetch(assistantUrl(`/jobs/${id}/cancel`), {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}`, apikey: env.supabasePublishableKey },
      signal: AbortSignal.timeout(jobTimeoutMs),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}
