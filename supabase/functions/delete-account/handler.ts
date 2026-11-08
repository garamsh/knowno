/** The delete-account request pipeline and the mapping from each outcome to an HTTP status. */

import { authenticate, SupabaseError, type UserId } from "../_shared/auth.ts";
import { deleteMedia, deleteUser } from "./admin.ts";
import { type AppleOutcome, revokeApple } from "./apple.ts";
import type { Config } from "./config.ts";

/** How a request ended; a refusal's body carries the same code. */
export type Outcome =
  | "deleted"
  | "method_not_allowed"
  | "not_configured"
  | "unauthenticated"
  | "delete_failed"
  | "internal";

/**
 * The one line logged per request. It carries these fields only: never the token, a code or a key.
 * `apple` is what came of revoking the user's Apple authorization, null before it was tried.
 */
export type LogEntry = {
  readonly user_id: UserId | null;
  readonly outcome: Outcome;
  readonly apple: AppleOutcome | null;
};

export type HandlerDeps = {
  readonly config: Config;
  readonly fetch: typeof fetch;
  /** The time in milliseconds, which dates the client secret. */
  readonly now: () => number;
  readonly log: (entry: LogEntry) => void;
};

export function status(outcome: Outcome): number {
  switch (outcome) {
    case "deleted":
      return 204;
    case "unauthenticated":
      return 401;
    case "method_not_allowed":
      return 405;
    case "internal":
      return 500;
    case "delete_failed":
      return 502;
    case "not_configured":
      return 503;
  }
}

type Result = {
  readonly outcome: Outcome;
  readonly userId: UserId | null;
  readonly apple: AppleOutcome | null;
};

export function createHandler(
  deps: HandlerDeps,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let result: Result;
    try {
      result = await handle(request, deps);
    } catch (error) {
      deps.log({ user_id: null, outcome: "internal", apple: null });
      throw error;
    }
    deps.log({
      user_id: result.userId,
      outcome: result.outcome,
      apple: result.apple,
    });
    return result.outcome === "deleted"
      ? new Response(null, { status: 204 })
      : Response.json({ error: result.outcome }, {
        status: status(result.outcome),
      });
  };
}

/**
 * The Apple authorization code the body names, or null: the body is optional, and a body that is
 * not JSON, or holds no code of a sensible size, names none.
 */
async function appleCode(request: Request): Promise<string | null> {
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) return null;
  const code = "apple_authorization_code" in body
    ? body.apple_authorization_code
    : null;
  return typeof code === "string" && code !== "" && code.length <= MAX_CODE
    ? code
    : null;
}

/** The longest authorization code taken; Apple's are far shorter. */
const MAX_CODE = 2048;

/**
 * The user deleted is always the token's. The body, when it carries `apple_authorization_code`,
 * lets the user's Apple authorization be revoked first; a revocation that cannot be done never
 * stops the deletion (ADR 0210).
 */
async function handle(request: Request, deps: HandlerDeps): Promise<Result> {
  if (request.method !== "POST") {
    return { outcome: "method_not_allowed", userId: null, apple: null };
  }
  const config = deps.config;
  if (config.kind === "not_configured") {
    return { outcome: "not_configured", userId: null, apple: null };
  }
  const supabase = {
    url: config.supabaseUrl,
    serviceRoleKey: config.serviceRoleKey,
    fetch: deps.fetch,
  };
  let userId: UserId | null = null;
  let apple: AppleOutcome | null = null;
  try {
    userId = await authenticate(request.headers.get("Authorization"), supabase);
    if (userId === null) return { outcome: "unauthenticated", userId, apple };
    // The objects first: once the user is gone, a failed retry could not be authenticated.
    await deleteMedia(userId, supabase);
    apple = await revokeApple(
      userId,
      await appleCode(request),
      config.apple,
      supabase,
      deps.now(),
    );
    await deleteUser(userId, supabase);
  } catch (error) {
    if (error instanceof SupabaseError) {
      return { outcome: "delete_failed", userId, apple };
    }
    throw error;
  }
  return { outcome: "deleted", userId, apple };
}
