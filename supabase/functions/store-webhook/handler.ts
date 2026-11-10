/**
 * The store-webhook request pipeline (ADR 0241): RevenueCat's webhook is a trigger. A call carrying
 * the Authorization value kept in Vault reads the user's current entitlements from RevenueCat's REST
 * API and sets or ends the user's store grant to match; the RevenueCat app user id is the Supabase
 * user id. A failure answers non-200, so RevenueCat retries; an unknown user or an event to ignore
 * answers 200.
 */

import { type SupabaseDeps, SupabaseError } from "../_shared/auth.ts";
import { same } from "../_shared/same.ts";
import type { Config } from "./config.ts";
import { read, RevenueCatError } from "./revenuecat.ts";
import { apply, secrets } from "./store.ts";

/** How a request ended; a refusal's body carries the same code. */
export type Outcome =
  | "applied"
  | "ignored"
  | "no_user"
  | "unauthorized"
  | "method_not_allowed"
  | "not_configured"
  | "unavailable"
  | "internal";

/** The one line logged per request: the outcome and, when one was applied, its result. Never an id or a secret. */
export type LogEntry = { readonly outcome: Outcome; readonly result?: string };

export type HandlerDeps = {
  readonly config: Config;
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly log: (entry: LogEntry) => void;
};

export function status(outcome: Outcome): number {
  switch (outcome) {
    case "applied":
    case "ignored":
    case "no_user":
      return 200;
    case "unauthorized":
      return 401;
    case "method_not_allowed":
      return 405;
    case "internal":
      return 500;
    case "unavailable":
      return 502;
    case "not_configured":
      return 503;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The app user id of an event that names a Supabase user, or null for any other body or event. */
function userOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("event" in body)) {
    return null;
  }
  const event = body.event;
  if (
    typeof event !== "object" || event === null || !("type" in event) ||
    event.type === "TEST" || !("app_user_id" in event) ||
    typeof event.app_user_id !== "string" || !UUID.test(event.app_user_id)
  ) {
    return null;
  }
  return event.app_user_id.toLowerCase();
}

type Result = { readonly outcome: Outcome; readonly result?: string };

export function createHandler(
  deps: HandlerDeps,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let ended: Result;
    try {
      ended = await handle(request, deps);
    } catch (error) {
      deps.log({ outcome: "internal" });
      throw error;
    }
    deps.log(ended);
    const body = ended.result === undefined
      ? { outcome: ended.outcome }
      : { outcome: ended.outcome, result: ended.result };
    return Response.json(body, { status: status(ended.outcome) });
  };
}

async function handle(request: Request, deps: HandlerDeps): Promise<Result> {
  if (request.method !== "POST") return { outcome: "method_not_allowed" };
  const config = deps.config;
  if (config.kind === "not_configured") return { outcome: "not_configured" };
  const supabase: SupabaseDeps = {
    url: config.supabaseUrl,
    serviceRoleKey: config.serviceRoleKey,
    fetch: deps.fetch,
  };
  try {
    const vault = await secrets(supabase);
    // The same comparison whether or not the value is set, so neither time nor answer tells them apart.
    const matches = await same(
      request.headers.get("Authorization") ?? "",
      vault.webhookAuthorization ?? "",
    );
    if (!matches || vault.webhookAuthorization === null) {
      return { outcome: "unauthorized" };
    }
    const userId = userOf(await request.json().catch(() => null));
    if (userId === null) return { outcome: "ignored" };
    if (vault.apiKey === null) return { outcome: "not_configured" };
    const entitlement = await read(
      userId,
      vault.apiKey,
      deps.now(),
      deps.fetch,
    );
    const result = entitlement.plan === null
      ? await apply(userId, null, null, false, supabase)
      : await apply(
        userId,
        entitlement.plan,
        entitlement.endsAt,
        entitlement.renews,
        supabase,
      );
    return result === "no_user"
      ? { outcome: "no_user" }
      : { outcome: "applied", result };
  } catch (error) {
    if (error instanceof SupabaseError || error instanceof RevenueCatError) {
      return { outcome: "unavailable" };
    }
    throw error;
  }
}
