/** The caller's suspension, and its plan's assistant configuration and message count (ADR 0190). */

import {
  type SupabaseDeps,
  SupabaseError,
  type UserId,
} from "../_shared/auth.ts";

/** The providers an assistant configuration may name, as `private.assistant_configurations` does. */
export const PROVIDERS = ["openrouter", "openai", "anthropic"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** How much a model reasons before it answers; `none` asks for no reasoning. */
export const EFFORTS = ["none", "low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

/** What serves a plan's assistant: its provider, model and instructions, and its settings. */
export type Configuration = {
  readonly id: number;
  readonly provider: Provider;
  readonly model: string;
  readonly promptVersionId: number;
  readonly prompt: string;
  readonly webSearch: boolean;
  readonly maxSearches: number;
  readonly effort: Effort;
};

/**
 * What one message of the user may do: be answered by its plan's configuration, counted against
 * the day's limit; be refused at that limit; be refused uncounted because the provider has no key
 * (ADR 0162); or nothing, when the plan has no configuration or limit.
 */
export type Start =
  | {
    readonly kind: "allowed";
    readonly messageId: number;
    readonly plan: string;
    readonly configuration: Configuration;
    /** The day's limit, null for none, and the messages counted today with this one. */
    readonly dailyLimit: number | null;
    readonly used: number;
  }
  | { readonly kind: "unavailable"; readonly plan: string }
  | {
    readonly kind: "rate_limited";
    readonly plan: string;
    readonly dailyLimit: number;
    readonly used: number;
  }
  | { readonly kind: "not_configured" };

/** How a turn ended, as `finish_assistant_message` records it. */
export type Outcome =
  | "ok"
  | "choice"
  | "depth_limit"
  | "time_limit"
  | "model_error";

/** What a turn used, summed over its model calls. */
export type Usage = {
  readonly modelCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly webSearchRequests: number;
};

async function rpc(
  name: string,
  body: Record<string, unknown>,
  deps: SupabaseDeps,
): Promise<unknown> {
  const response = await deps.fetch(`${deps.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: deps.serviceRoleKey,
      Authorization: `Bearer ${deps.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch((cause: unknown) => {
    throw new SupabaseError(`${name} could not be reached`, { cause });
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new SupabaseError(`${name} answered ${response.status}`);
  }
  return response.status === 204 ? null : await response.json();
}

/** Whether an admin suspended the user (`public.user_suspended`). */
export async function userSuspended(
  userId: UserId,
  deps: SupabaseDeps,
): Promise<boolean> {
  const suspended = await rpc("user_suspended", { user_id: userId }, deps);
  if (typeof suspended !== "boolean") {
    throw new SupabaseError("user_suspended answered no boolean");
  }
  return suspended;
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * Resolves the user's plan and the assistant configuration serving it (an admin's plan's draft
 * while one is set) and, when its provider has a key in Vault and under the day's limit, records
 * the message (`public.begin_assistant_message`).
 */
export async function beginMessage(
  userId: UserId,
  deps: SupabaseDeps,
): Promise<Start> {
  const rows = await rpc("begin_assistant_message", { user_id: userId }, deps);
  if (!Array.isArray(rows)) {
    throw new SupabaseError("begin_assistant_message answered no rows");
  }
  if (rows.length === 0) return { kind: "not_configured" };
  const row: unknown = rows[0];
  if (typeof row !== "object" || row === null) {
    throw new SupabaseError("begin_assistant_message answered no row");
  }
  const r = row as Record<string, unknown>;
  const provider = PROVIDERS.find((known) => known === r.provider);
  const effort = EFFORTS.find((known) => known === r.reasoning_effort);
  if (
    typeof r.plan !== "string" || provider === undefined ||
    effort === undefined || !isCount(r.configuration_id) ||
    typeof r.model !== "string" || !isCount(r.prompt_version_id) ||
    typeof r.prompt !== "string" || typeof r.web_search !== "boolean" ||
    !isCount(r.max_searches) || typeof r.available !== "boolean" ||
    (r.daily_limit !== null && !isCount(r.daily_limit)) ||
    !isCount(r.used) || typeof r.allowed !== "boolean"
  ) {
    throw new SupabaseError(
      "begin_assistant_message answered a row it should not",
    );
  }
  if (!r.available) return { kind: "unavailable", plan: r.plan };
  if (!r.allowed) {
    if (r.daily_limit === null) {
      throw new SupabaseError("begin_assistant_message refused under no limit");
    }
    return {
      kind: "rate_limited",
      plan: r.plan,
      dailyLimit: r.daily_limit as number,
      used: r.used,
    };
  }
  if (!isCount(r.message_id)) {
    throw new SupabaseError(
      "begin_assistant_message allowed a message it did not record",
    );
  }
  return {
    kind: "allowed",
    messageId: r.message_id,
    plan: r.plan,
    dailyLimit: r.daily_limit as number | null,
    used: r.used,
    configuration: {
      id: r.configuration_id,
      provider,
      model: r.model,
      promptVersionId: r.prompt_version_id,
      prompt: r.prompt,
      webSearch: r.web_search,
      maxSearches: r.max_searches,
      effort,
    },
  };
}

/** Records how [messageId]'s turn ended and what it used (`public.finish_assistant_message`). */
export async function finishMessage(
  messageId: number,
  outcome: Outcome,
  usage: Usage,
  latencyMs: number,
  deps: SupabaseDeps,
): Promise<void> {
  await rpc("finish_assistant_message", {
    message_id: messageId,
    outcome,
    model_calls: usage.modelCalls,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    reasoning_tokens: usage.reasoningTokens,
    web_search_requests: usage.webSearchRequests,
    latency_ms: Math.round(latencyMs),
  }, deps);
}
