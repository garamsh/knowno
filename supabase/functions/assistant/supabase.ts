/** The caller's suspension, and its plan's assistant configuration and message count (ADR 0190). */

import {
  type SupabaseDeps,
  SupabaseError,
  type UserId,
} from "../_shared/auth.ts";
import { type Provider, PROVIDERS } from "../_shared/keys.ts";

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
 * What one message of the user may do (ADR 0195): be answered by its plan's configuration, its
 * tokens charged when it ends; be refused with the day's token budget spent, or while another of
 * the user's messages is still running; be refused because the provider has no key (ADR 0162); or
 * nothing, when the plan has no configuration or budget.
 */
export type Start =
  | {
    readonly kind: "allowed";
    readonly messageId: number;
    readonly plan: string;
    readonly configuration: Configuration;
    /** The day's token budget, null for none, and the tokens charged today before this message. */
    readonly tokenBudget: number | null;
    readonly tokensUsed: number;
  }
  | { readonly kind: "unavailable"; readonly plan: string }
  | {
    readonly kind: "rate_limited";
    readonly plan: string;
    readonly tokenBudget: number;
    readonly tokensUsed: number;
  }
  | { readonly kind: "busy"; readonly plan: string }
  | { readonly kind: "not_configured" };

/** How a turn ended, as `finish_assistant_message` records it. */
export type Outcome =
  | "ok"
  | "choice"
  | "depth_limit"
  | "time_limit"
  | "model_error"
  | "cut"
  | "cancelled";

/** What a turn used, summed over its model calls. */
export type Usage = {
  readonly modelCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly webSearchRequests: number;
};

/**
 * The tokens a message is charged against its plan's budget: its input and output tokens, the
 * output including the reasoning tokens (ADR 0195), as `begin_assistant_message` sums them.
 */
export function charged(usage: Usage): number {
  return usage.inputTokens + usage.outputTokens;
}

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
 * while one is set) and, when its provider has a key in Vault, the day's token budget is not
 * spent and no other message of the user is running, records the message
 * (`public.begin_assistant_message`).
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
    (r.token_budget !== null && !isCount(r.token_budget)) ||
    !isCount(r.tokens_used) || typeof r.busy !== "boolean" ||
    typeof r.allowed !== "boolean"
  ) {
    throw new SupabaseError(
      "begin_assistant_message answered a row it should not",
    );
  }
  if (!r.available) return { kind: "unavailable", plan: r.plan };
  if (!r.allowed) {
    if (isCount(r.token_budget) && r.tokens_used >= r.token_budget) {
      return {
        kind: "rate_limited",
        plan: r.plan,
        tokenBudget: r.token_budget,
        tokensUsed: r.tokens_used,
      };
    }
    if (r.busy) return { kind: "busy", plan: r.plan };
    throw new SupabaseError(
      "begin_assistant_message refused a message for no reason it names",
    );
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
    tokenBudget: r.token_budget as number | null,
    tokensUsed: r.tokens_used,
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

/**
 * Whether the bearer of [token] is an admin, through `public.admin_ai_session` called as that
 * user, as extract-cards asks it: a caller who is not one is refused there.
 */
export async function isAdmin(
  token: string,
  deps: SupabaseDeps,
): Promise<boolean> {
  const response = await deps.fetch(
    `${deps.url}/rest/v1/rpc/admin_ai_session`,
    {
      method: "POST",
      headers: {
        apikey: deps.serviceRoleKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    },
  ).catch((cause: unknown) => {
    throw new SupabaseError("admin_ai_session could not be reached", {
      cause,
    });
  });
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    return false;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new SupabaseError(`admin_ai_session answered ${response.status}`);
  }
  if (typeof await response.json() !== "boolean") {
    throw new SupabaseError("admin_ai_session answered no boolean");
  }
  return true;
}

/** An assistant configuration an admin saves as a plan's draft. */
export type Draft = {
  readonly plan: string;
  readonly provider: Provider;
  readonly model: string;
  /** Undefined keeps the draft's prompt, or else the active configuration's. */
  readonly promptVersionId: number | undefined;
  readonly webSearch: boolean;
  readonly maxSearches: number;
  readonly effort: Effort;
};

/**
 * Whether [draft]'s model can run at its effort, by Anthropic's per-model thinking table
 * (`public.assistant_effort_fits`), as the database holds every configuration to it.
 */
export async function effortFits(
  draft: Draft,
  deps: SupabaseDeps,
): Promise<boolean> {
  const fits = await rpc("assistant_effort_fits", {
    provider: draft.provider,
    model: draft.model,
    effort: draft.effort,
  }, deps);
  if (typeof fits !== "boolean") {
    throw new SupabaseError("assistant_effort_fits answered no boolean");
  }
  return fits;
}

/**
 * Saves [draft] as its plan's one draft for [adminId], through
 * `public.save_assistant_configuration`, answering the configuration's id; null when the database
 * holds no such prompt or the model cannot run at the effort.
 */
export async function saveConfiguration(
  adminId: UserId,
  draft: Draft,
  deps: SupabaseDeps,
): Promise<number | null> {
  const id = await rpc("save_assistant_configuration", {
    admin_id: adminId,
    plan: draft.plan,
    provider: draft.provider,
    model: draft.model,
    ...(draft.promptVersionId === undefined
      ? {}
      : { prompt_version_id: draft.promptVersionId }),
    web_search: draft.webSearch,
    max_searches: draft.maxSearches,
    reasoning_effort: draft.effort,
  }, deps);
  if (id === null) return null;
  if (!isCount(id)) {
    throw new SupabaseError("save_assistant_configuration answered no id");
  }
  return id;
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
