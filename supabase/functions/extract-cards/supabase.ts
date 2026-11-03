/** The caller's plan, prompt and photo count, through `public.begin_extraction`, and its outcome. */

import {
  type SupabaseDeps,
  SupabaseError,
  type UserId,
} from "../_shared/auth.ts";
import type { CursorToken } from "./continuation.ts";
import { type ModelId, modelId } from "./model.ts";
import { parseProvider, type Provider } from "./providers.ts";

/** The plans, as `private.plan_versions` names them; `special` has no photo limit (ADR 0177). */
export const PLANS = ["free", "pro", "max", "special"] as const;
export type Plan = (typeof PLANS)[number];

export function parsePlan(value: unknown): Plan | null {
  return PLANS.find((known) => known === value) ?? null;
}

/** The period a plan's photo limit counts over: a calendar month or a day in Asia/Seoul. */
export type Period = "month" | "day";

/** A saved prompt version: its id in `private.prompt_versions` and the instructions it holds. */
export type Prompt = { readonly versionId: number; readonly text: string };

/**
 * What one photo of the user may do: be extracted by the provider and model of the configuration
 * serving it, with the prompt the user is served, recorded against the photo limit of the plan's
 * version for its period; be refused at that limit; be refused uncounted because that provider has
 * no key (ADR 0162); or nothing, when the plan has no version or configuration, the active prompt
 * is missing, or the configuration names no model the function would call.
 */
export type Start =
  | {
    readonly kind: "allowed";
    /** The `extraction_usage` row recorded for the photo, which names its call record. */
    readonly usageId: number;
    readonly plan: Plan;
    readonly provider: Provider;
    readonly model: ModelId;
    readonly prompt: Prompt;
  }
  | { readonly kind: "unavailable"; readonly plan: Plan }
  | {
    readonly kind: "rate_limited";
    readonly plan: Plan;
    readonly photoLimit: number;
    readonly period: Period;
  }
  | { readonly kind: "not_configured" };

/** Whether an admin suspended the user (`public.user_suspended`); a suspended user extracts nothing. */
export async function userSuspended(
  userId: UserId,
  deps: SupabaseDeps,
): Promise<boolean> {
  const response = await deps.fetch(
    `${deps.url}/rest/v1/rpc/user_suspended`,
    {
      method: "POST",
      headers: {
        apikey: deps.serviceRoleKey,
        Authorization: `Bearer ${deps.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: userId }),
    },
  );
  if (!response.ok) {
    throw new SupabaseError(`user_suspended answered ${response.status}`);
  }
  const suspended: unknown = await response.json();
  if (typeof suspended !== "boolean") {
    throw new SupabaseError("user_suspended answered no boolean");
  }
  return suspended;
}

/**
 * Resolves the user's plan, prompt and configuration (ADR 0073, ADR 0162: an admin is served the
 * test version and configuration while one is set, or the [configurationId] a trial names) and,
 * when its provider has a key in Vault and under
 * the photo limit of the plan's version, records the photo with what serves it.
 */
export async function beginExtraction(
  userId: UserId,
  configurationId: number | null,
  deps: SupabaseDeps,
): Promise<Start> {
  const response = await deps.fetch(
    `${deps.url}/rest/v1/rpc/begin_extraction`,
    {
      method: "POST",
      headers: {
        apikey: deps.serviceRoleKey,
        Authorization: `Bearer ${deps.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: userId,
        configuration_id: configurationId,
      }),
    },
  );
  if (!response.ok) {
    throw new SupabaseError(`begin_extraction answered ${response.status}`);
  }
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) {
    throw new SupabaseError("begin_extraction answered no rows");
  }
  if (rows.length === 0) return { kind: "not_configured" };
  const row: unknown = rows[0];
  if (typeof row !== "object" || row === null) {
    throw new SupabaseError("begin_extraction answered a row that is not one");
  }
  const {
    plan: planName,
    provider: providerName,
    model,
    available,
    photo_limit: limit,
    period,
    allowed,
    prompt_version_id: versionId,
    prompt,
    usage_id: usageId,
  } = row as Record<string, unknown>;
  const plan = parsePlan(planName);
  const provider = parseProvider(providerName);
  // Null for a plan with no limit, whose photos are never refused.
  const photoLimit = typeof limit === "number" ? limit : null;
  if (
    plan === null ||
    (period !== "month" && period !== "day") || provider === null ||
    typeof available !== "boolean" ||
    typeof allowed !== "boolean" || (limit !== null && photoLimit === null) ||
    typeof versionId !== "number" || !Number.isSafeInteger(versionId) ||
    typeof prompt !== "string"
  ) {
    throw new SupabaseError("begin_extraction answered a row it should not");
  }
  if (!available) return { kind: "unavailable", plan };
  if (!allowed) {
    if (photoLimit === null) {
      throw new SupabaseError(
        "begin_extraction refused a photo under no limit",
      );
    }
    return { kind: "rate_limited", plan, photoLimit, period };
  }
  if (typeof usageId !== "number" || !Number.isSafeInteger(usageId)) {
    throw new SupabaseError(
      "begin_extraction allowed a photo it did not record",
    );
  }
  const id = typeof model === "string" ? modelId(provider, model) : null;
  return id === null ? { kind: "not_configured" } : {
    kind: "allowed",
    usageId,
    plan,
    provider,
    model: id,
    prompt: { versionId, text: prompt },
  };
}

/** How a counted photo's model calls failed, each attempt's kind in `Finish.failures`. */
export type AttemptFailure = "invalid_output" | "model_error" | "timeout";

/**
 * How a counted photo's extraction ended (ADR 0130): its outcome, its first read's model calls and
 * the failure of each that failed, the request's milliseconds until then, the cards answered and
 * the replies' cards dropped, and whether the page was left unread past the cards answered (ADR
 * 0135, ADR 0138). `continuations` counts the calls that read on after a cut reply, and `cursor` is
 * the token a later request goes on with, null when the page is done.
 */
export type Finish = {
  readonly outcome: "ok" | "no_cards" | "invalid_output" | "model_error";
  readonly attempts: 1 | 2;
  readonly latencyMs: number;
  readonly cardsReturned: number;
  readonly cardsDropped: number;
  readonly failures: readonly AttemptFailure[];
  readonly truncated: boolean;
  readonly continuations: number;
  readonly cursor: CursorToken | null;
};

/**
 * Records [finish] on the call record of [usageId], through `public.finish_extraction`, answering
 * whether it was recorded. The record is telemetry: its failure never decides the photo's answer.
 */
export async function finishExtraction(
  usageId: number,
  finish: Finish,
  deps: SupabaseDeps,
): Promise<boolean> {
  const response = await deps.fetch(
    `${deps.url}/rest/v1/rpc/finish_extraction`,
    {
      method: "POST",
      headers: {
        apikey: deps.serviceRoleKey,
        Authorization: `Bearer ${deps.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        usage_id: usageId,
        outcome: finish.outcome,
        attempts: finish.attempts,
        latency_ms: Math.round(finish.latencyMs),
        cards_returned: finish.cardsReturned,
        cards_dropped: finish.cardsDropped,
        failures: finish.failures,
        truncated: finish.truncated,
        continuations: finish.continuations,
        cursor: finish.cursor,
      }),
    },
  ).catch(() => null);
  return response?.ok ?? false;
}

/**
 * A photo a cursor goes on with (ADR 0138): its usage row, the plan, model and prompt version that
 * served its first read, and the cards and continuing calls it has had; or `refused`, when the
 * cursor is unknown, used, expired or another user's.
 */
export type Resume =
  | {
    readonly kind: "resumed";
    readonly usageId: number;
    readonly plan: Plan;
    readonly provider: Provider;
    readonly model: ModelId;
    readonly prompt: Prompt;
    readonly cardsRead: number;
    readonly continuations: number;
  }
  | { readonly kind: "refused" }
  | { readonly kind: "not_configured" };

/** Takes [token] for [userId] through `public.resume_extraction`, so it cannot be taken again. */
export async function resumeExtraction(
  userId: UserId,
  token: CursorToken,
  deps: SupabaseDeps,
): Promise<Resume> {
  const response = await deps.fetch(
    `${deps.url}/rest/v1/rpc/resume_extraction`,
    {
      method: "POST",
      headers: {
        apikey: deps.serviceRoleKey,
        Authorization: `Bearer ${deps.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: userId, cursor: token }),
    },
  );
  if (!response.ok) {
    throw new SupabaseError(`resume_extraction answered ${response.status}`);
  }
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) {
    throw new SupabaseError("resume_extraction answered no rows");
  }
  if (rows.length === 0) return { kind: "refused" };
  const row: unknown = rows[0];
  if (typeof row !== "object" || row === null) {
    throw new SupabaseError("resume_extraction answered a row that is not one");
  }
  const {
    usage_id: usageId,
    plan: planName,
    provider: providerName,
    model,
    prompt_version_id: versionId,
    prompt,
    cards_read: cardsRead,
    continuations,
  } = row as Record<string, unknown>;
  const plan = parsePlan(planName);
  const provider = parseProvider(providerName);
  if (
    plan === null ||
    provider === null ||
    !isCount(usageId) || !isCount(versionId) || typeof prompt !== "string" ||
    !isCount(cardsRead) || !isCount(continuations)
  ) {
    throw new SupabaseError("resume_extraction answered a row it should not");
  }
  const id = typeof model === "string" ? modelId(provider, model) : null;
  return id === null ? { kind: "not_configured" } : {
    kind: "resumed",
    usageId,
    plan,
    provider,
    model: id,
    prompt: { versionId, text: prompt },
    cardsRead,
    continuations,
  };
}

/**
 * How a request that went on with a cursor read: its continuing calls, the cards it answered,
 * whether the page is still unread past them, and the next cursor, null when the page is done.
 */
export type Resumed = {
  readonly continuations: number;
  readonly cardsReturned: number;
  readonly truncated: boolean;
  readonly cursor: CursorToken | null;
};

/**
 * Adds [resumed] to the call record of [usageId], through `public.record_resumed_extraction`,
 * answering whether it was recorded. Like `finishExtraction`, it never decides the answer.
 */
export async function recordResumed(
  usageId: number,
  resumed: Resumed,
  deps: SupabaseDeps,
): Promise<boolean> {
  const response = await deps.fetch(
    `${deps.url}/rest/v1/rpc/record_resumed_extraction`,
    {
      method: "POST",
      headers: {
        apikey: deps.serviceRoleKey,
        Authorization: `Bearer ${deps.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        usage_id: usageId,
        continuations: resumed.continuations,
        cards_returned: resumed.cardsReturned,
        truncated: resumed.truncated,
        cursor: resumed.cursor,
      }),
    },
  ).catch(() => null);
  return response?.ok ?? false;
}

/**
 * Whether the bearer of [token] is an admin who signed in within the last 10 minutes, through
 * `public.admin_ai_session` called as that user: `recent`, `stale`, or `not_admin`.
 */
export async function adminSession(
  token: string,
  deps: SupabaseDeps,
): Promise<"recent" | "stale" | "not_admin"> {
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
  );
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    return "not_admin";
  }
  if (!response.ok) {
    throw new SupabaseError(`admin_ai_session answered ${response.status}`);
  }
  const recent: unknown = await response.json();
  if (typeof recent !== "boolean") {
    throw new SupabaseError("admin_ai_session answered no boolean");
  }
  return recent ? "recent" : "stale";
}

/** Calls the `service_role` function [name] with [args], answering its JSON result. */
async function serviceCall(
  name: string,
  args: Record<string, unknown>,
  deps: SupabaseDeps,
): Promise<unknown> {
  const response = await deps.fetch(`${deps.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: deps.serviceRoleKey,
      Authorization: `Bearer ${deps.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    await response.body?.cancel();
    // The status alone: the arguments may hold a key.
    throw new SupabaseError(`${name} answered ${response.status}`);
  }
  return await response.json();
}

/**
 * Stores [key] in Vault as [provider]'s for [adminId], through `public.save_provider_key`, after
 * its check call parsed: whether it was saved, or refused as malformed.
 */
export async function saveProviderKey(
  adminId: UserId,
  provider: Provider,
  key: string,
  deps: SupabaseDeps,
): Promise<boolean> {
  const answer = await serviceCall("save_provider_key", {
    admin_id: adminId,
    provider,
    key,
  }, deps);
  if (answer !== "saved" && answer !== "bad_key") {
    throw new SupabaseError("save_provider_key answered an unknown result");
  }
  return answer === "saved";
}

/**
 * Saves [provider] and [model] as [plan]'s draft for [adminId], through
 * `public.save_ai_configuration`, after its check call parsed, answering the configuration's id.
 */
export async function saveConfiguration(
  adminId: UserId,
  plan: Plan,
  provider: Provider,
  model: ModelId,
  deps: SupabaseDeps,
): Promise<number> {
  const id = await serviceCall("save_ai_configuration", {
    admin_id: adminId,
    plan,
    provider,
    model,
  }, deps);
  if (!isCount(id)) {
    throw new SupabaseError("save_ai_configuration answered no id");
  }
  return id;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
