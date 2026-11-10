/**
 * The store-webhook request pipeline (ADR 0241): RevenueCat's webhook is a trigger. A call carrying
 * the Authorization value kept in Vault reads the user's current entitlements from RevenueCat's REST
 * API and sets or ends the user's store grant to match; the RevenueCat app user id is the Supabase
 * user id. A failure answers non-200, so RevenueCat retries; an unknown user or an event to ignore
 * answers 200.
 */

import {
  authenticate,
  type SupabaseDeps,
  SupabaseError,
} from "../_shared/auth.ts";
import { same } from "../_shared/same.ts";
import type { Config } from "./config.ts";
import { read, RevenueCatError } from "./revenuecat.ts";
import { apply, begin, secrets } from "./store.ts";

/** How a request ended; a refusal's body carries the same code. */
export type Outcome =
  | "applied"
  | "ignored"
  | "no_user"
  | "unauthorized"
  | "rate_limited"
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
    case "rate_limited":
      return 429;
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

/** The Supabase user ids an event concerns, none for any other body or event. */
function usersOf(body: unknown): string[] {
  if (typeof body !== "object" || body === null || !("event" in body)) {
    return [];
  }
  const event = body.event;
  if (typeof event !== "object" || event === null || !("type" in event)) {
    return [];
  }
  if (event.type === "TEST") return [];
  // A TRANSFER names no app_user_id: the entitlement moved from one set of ids to another.
  const named: unknown[] = event.type === "TRANSFER"
    ? [
      ..."transferred_from" in event && Array.isArray(event.transferred_from)
        ? event.transferred_from
        : [],
      ..."transferred_to" in event && Array.isArray(event.transferred_to)
        ? event.transferred_to
        : [],
    ]
    : ["app_user_id" in event ? event.app_user_id : null];
  const ids = named.filter((id): id is string =>
    typeof id === "string" && UUID.test(id)
  ).map((id) => id.toLowerCase());
  return [...new Set(ids)];
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
    return Response.json(body, {
      status: status(ended.outcome),
      headers: ended.outcome === "rate_limited" ? { "Retry-After": "600" } : {},
    });
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
  const sync = new URL(request.url).pathname.endsWith("/sync");
  try {
    if (sync) return await syncCaller(request, deps, supabase);
    const vault = await secrets(supabase);
    // The same comparison whether or not the value is set, so neither time nor answer tells them apart.
    const matches = await same(
      request.headers.get("Authorization") ?? "",
      vault.webhookAuthorization ?? "",
    );
    if (!matches || vault.webhookAuthorization === null) {
      return { outcome: "unauthorized" };
    }
    const userIds = usersOf(await request.json().catch(() => null));
    if (userIds.length === 0) return { outcome: "ignored" };
    if (vault.apiKey === null) return { outcome: "not_configured" };
    return await converge(userIds, vault.apiKey, deps, supabase);
  } catch (error) {
    if (error instanceof SupabaseError || error instanceof RevenueCatError) {
      return { outcome: "unavailable" };
    }
    throw error;
  }
}

/**
 * Reads every user's current entitlements before applying any, so one failed read changes no grant
 * and answers non-200, then applies each.
 */
async function converge(
  userIds: readonly string[],
  apiKey: string,
  deps: HandlerDeps,
  supabase: SupabaseDeps,
): Promise<Result> {
  const entitlements = [];
  for (const userId of userIds) {
    entitlements.push(await read(userId, apiKey, deps.now(), deps.fetch));
  }
  const results: string[] = [];
  for (const [i, userId] of userIds.entries()) {
    const entitlement = entitlements[i];
    const result = entitlement.plan === null
      ? await apply(userId, null, null, false, supabase)
      : await apply(
        userId,
        entitlement.plan,
        entitlement.endsAt,
        entitlement.renews,
        supabase,
      );
    if (result !== "no_user") results.push(result);
  }
  return results.length === 0
    ? { outcome: "no_user" }
    : { outcome: "applied", result: results.join(",") };
}

/**
 * The sync route: the signed-in caller's own entitlements, read and applied as a webhook for them
 * would. The session is verified here, the body is never read, and no id but the caller's is used.
 */
async function syncCaller(
  request: Request,
  deps: HandlerDeps,
  supabase: SupabaseDeps,
): Promise<Result> {
  const userId = await authenticate(
    request.headers.get("Authorization"),
    supabase,
  );
  if (userId === null) return { outcome: "unauthorized" };
  if (!await begin(userId, supabase)) return { outcome: "rate_limited" };
  const vault = await secrets(supabase);
  if (vault.apiKey === null) return { outcome: "not_configured" };
  return await converge([userId], vault.apiKey, deps, supabase);
}
