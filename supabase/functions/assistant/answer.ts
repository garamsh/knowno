/**
 * What every route of the assistant answers with: the log line, the handler's dependencies, a
 * refusal, and the reads of a caller's body and standing that a message and a commit share.
 */

import {
  type SupabaseDeps,
  SupabaseError,
  type UserId,
} from "../_shared/auth.ts";
import type { CardForms } from "../_shared/card_forms.ts";
import type { Keys } from "../_shared/keys.ts";
import type { Store } from "../_shared/store.ts";
import type { ToolDeps } from "../_shared/tools.ts";
import type { Config } from "./config.ts";
import type { SettingsOutcome } from "./settings.ts";
import { type Outcome, userSuspended } from "./supabase.ts";

/** The largest body a request may hold, proposals included, once its replies are shortened. */
export const MAX_BODY_BYTES = 512 * 1024;

/** How a request ended: a refusal's code, the turn's outcome, or a photo read's. */
export type LogOutcome =
  | Outcome
  | "unreadable"
  | "not_sent"
  | "polled"
  | "working"
  | "committed"
  | "bad_request"
  | "unauthenticated"
  | "suspended"
  | "method_not_allowed"
  | "not_found"
  | "too_large"
  | "rate_limited"
  | "busy"
  | "refused"
  | "not_configured"
  | "unavailable"
  | "internal"
  | SettingsOutcome["kind"];

/** The one line logged per request: never the token, a key, a message or a card. */
export type LogEntry = {
  readonly route:
    | "message"
    | "commit"
    | "settings"
    | "job"
    | "cancel"
    | "work"
    | null;
  readonly user_id: UserId | null;
  readonly plan: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly model_calls: number | null;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly reasoning_tokens: number | null;
  readonly web_search_requests: number | null;
  readonly latency_ms: number;
  readonly outcome_recorded: boolean | null;
  readonly outcome: LogOutcome;
  /** A commit's note left behind because its deletion was refused, and why: never a card. */
  readonly left_deck_id?: string;
  readonly left_reason?: string;
};

export type HandlerDeps = ToolDeps & {
  readonly config: Config;
  readonly fetch: typeof fetch;
  readonly log: (entry: LogEntry) => void;
  readonly keys: Keys;
  readonly skills: CardForms;
  /** Keeps the invocation alive for [task] after its response, as `EdgeRuntime.waitUntil` does. */
  readonly background: (task: Promise<void>) => void;
  /** A promise that settles after [ms]. */
  readonly wait: (ms: number) => Promise<void>;
};

export type Entry = Omit<LogEntry, "latency_ms">;

export const blank: Entry = {
  route: null,
  user_id: null,
  plan: null,
  provider: null,
  model: null,
  model_calls: null,
  input_tokens: null,
  output_tokens: null,
  reasoning_tokens: null,
  web_search_requests: null,
  outcome_recorded: null,
  outcome: "internal",
};

export function refusal(
  status: number,
  error: LogOutcome,
  entry: Entry,
  extra: Record<string, unknown> = {},
): { response: Response; entry: Entry } {
  return {
    response: Response.json({ error, ...extra }, { status }),
    entry: { ...entry, outcome: error },
  };
}

/** What a route answers: the response, and the line to log, null where a stream logs its own. */
export type Answer = { response: Response; entry: Entry | null };

/** A request admitted to a route: the function's configuration, and its line so far. */
export type Call = {
  readonly request: Request;
  readonly deps: HandlerDeps;
  readonly config: Extract<Config, { kind: "configured" }>;
  /** The service-role key's access: the caller's user, the message record and Vault, never the tools. */
  readonly service: SupabaseDeps;
  readonly started: number;
  /** Logs [entry] with the request's latency. */
  readonly log: (entry: Entry) => void;
  readonly entry: Entry;
};

/** A request whose bearer token Supabase Auth accepted. */
export type Caller = Call & { readonly userId: UserId; readonly token: string };

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The JSON body of [request] of at most [cap] bytes, or the refusal of one too large or not JSON. */
export async function readBody(
  request: Request,
  cap: number,
  entry: Entry,
): Promise<{ body: unknown } | { answer: Answer }> {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > cap) return { answer: refusal(413, "too_large", entry) };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > cap) {
    return { answer: refusal(413, "too_large", entry) };
  }
  try {
    return { body: JSON.parse(raw) };
  } catch {
    return { answer: refusal(400, "bad_request", entry) };
  }
}

/** The refusal of a suspended caller, or of Supabase not answering, or null for one in good standing. */
export async function refuseSuspended(caller: Caller): Promise<Answer | null> {
  try {
    if (await userSuspended(caller.userId, caller.service)) {
      return refusal(403, "suspended", caller.entry);
    }
  } catch (error) {
    if (error instanceof SupabaseError) {
      return refusal(503, "unavailable", caller.entry);
    }
    throw error;
  }
  return null;
}

/** The tools' store: the caller's token, so they act under row-level security. */
export function storeOf(caller: Caller): Store {
  return {
    url: caller.config.supabaseUrl,
    anonKey: caller.config.anonKey,
    token: caller.token,
    userId: caller.userId,
    fetch: caller.deps.fetch,
  };
}
