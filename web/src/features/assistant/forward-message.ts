import "server-only";

import { env } from "@/env";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";

/**
 * The most a message body may hold on its way through: the function's `MAX_REQUEST_BYTES`, 512 KiB
 * beside 40 turns of its longest reply, is under it, so the function decides every size it refuses.
 */
const maxBodyBytes = 2 * 1024 * 1024;

const refusal = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/** The function's address under the project's URL. */
export function assistantUrl(path = ""): string {
  return `${env.supabaseUrl.replace(/\/$/u, "")}/functions/v1/assistant${path}`;
}

/**
 * The signed-in user's access token, read as `commitProposal` and every call to the function does,
 * or the status a refusal is answered with: 401 for a session that is none or was rejected, 503
 * where Supabase could not say.
 */
export async function readUserToken(): Promise<{ token: string } | { status: 401 | 503 }> {
  const client = await createClient();
  const user = await readUserId(client);
  if ("failure" in user) return { status: user.failure === "rejected" ? 401 : 503 };
  const token = (await client.auth.getSession()).data.session?.access_token;
  return token ? { token } : { status: 401 };
}

/**
 * Sends a message's [request] body to the assistant function as the verified user, without a
 * browser CORS request, and answers with the function's own status and body, its stream passed on
 * as it arrives. The browser going away aborts the call, which the function records as cancelled.
 * Logs one line per message, its status and the time to its first byte, never its text or token.
 */
export async function forwardMessage(request: Request): Promise<Response> {
  const body = await request.arrayBuffer();
  if (body.byteLength > maxBodyBytes) return refusal(413, "too_large");
  const session = await readUserToken();
  if ("status" in session)
    return session.status === 401 ? refusal(401, "unauthenticated") : refusal(503, "unavailable");
  const { token } = session;
  const started = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(assistantUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.supabasePublishableKey,
        "Content-Type": "application/json",
      },
      body,
      signal: request.signal,
    });
  } catch {
    console.info(JSON.stringify({ event: "assistant_message", status: "unreachable" }));
    return refusal(503, "unavailable");
  }
  console.info(
    JSON.stringify({
      event: "assistant_message",
      status: upstream.status,
      ms: Date.now() - started,
    }),
  );
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}
