import "server-only";

import { env } from "@/env";

import { assistantUrl, readUserToken } from "./forward-message";

/** Whether [id] is a uuid, as a job's id is, before it joins a path. */
export const isJobId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id);

/** How long the function may take to answer a poll or a cancel. */
export const jobTimeoutMs = 15_000;

const refusal = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Asks the function how far the photo job [id] has read (`assistant.md` §Photo jobs), as the
 * verified user, and answers with its status and body. A visitor not signed in is answered `401`
 * and an id that is no uuid `404`, neither calling the function.
 */
export async function forwardJobPoll(id: string): Promise<Response> {
  if (!isJobId(id)) return refusal(404, "not_found");
  const session = await readUserToken();
  if ("status" in session)
    return session.status === 401 ? refusal(401, "unauthenticated") : refusal(503, "unavailable");
  let upstream: Response;
  try {
    upstream = await fetch(assistantUrl(`/jobs/${id}`), {
      headers: { Authorization: `Bearer ${session.token}`, apikey: env.supabasePublishableKey },
      signal: AbortSignal.timeout(jobTimeoutMs),
    });
  } catch {
    return refusal(503, "unavailable");
  }
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}
