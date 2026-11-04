/**
 * The admin area's AI settings (ADR 0162, ADR 0182): saving a provider's key, or a plan's provider,
 * model and prompt version as its one draft, each only after one real call with the provider and
 * model parsed under the output contract.
 */

import {
  cardsSchema,
  composeInstructions,
  OUTPUT_CONTRACT,
  parseReply,
} from "./cards.ts";
import type { Keys } from "../_shared/keys.ts";
import { callModel, type ExtractDeps, type ModelId, modelId } from "./model.ts";
import { parseProvider, type Provider } from "./providers.ts";
import type { Image } from "./request.ts";
import {
  adminSession,
  parsePlan,
  saveConfiguration,
  saveProviderKey,
} from "./supabase.ts";
import {
  authenticate,
  type SupabaseDeps,
  type UserId,
} from "../_shared/auth.ts";

/** A white 64 by 32 PNG: the image the check call sends, which holds nothing to read. */
export const CHECK_IMAGE: Image = {
  type: "image/png",
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAAM0lEQVR42u3PMQ0AAAwDoPo33WrYuQQckD4XAQEBAQEBAQEBAQEBAQEBAQEBAQEBAYGrAX6h6VrZbbgHAAAAAElFTkSuQmCC",
};

/** The check call's instructions before the output contract, and the most tokens it may answer. */
export const CHECK_PROMPT =
  "Make a card of each entry the material shows. When it shows none, answer an empty list.";
export const CHECK_MAX_TOKENS = 1024;

/** Why a check call did not parse, each the sentence the admin form shows names. */
export type CheckFailure =
  | "key_refused"
  | "model_not_found"
  | "no_image_input"
  | "bad_output"
  | "call_failed";

/**
 * One minimal call to [model] with [deps]' key: the check image, the output contract and the
 * strict schema. Null when its reply parses as the contract's envelope, whatever its cards; the
 * failure otherwise. A refusal's body is read only to name the failure.
 */
export async function checkCall(
  model: ModelId,
  deps: ExtractDeps,
): Promise<CheckFailure | null> {
  const call = await callModel({
    model,
    instructions: composeInstructions(CHECK_PROMPT, OUTPUT_CONTRACT),
    image: CHECK_IMAGE,
    languages: {},
    form: {
      schema: cardsSchema,
      contract: OUTPUT_CONTRACT,
      parse: parseReply,
      maxTokens: CHECK_MAX_TOKENS,
    },
  }, deps);
  if (call.reply !== null) {
    return parseReply(call.reply) === null ? "bad_output" : null;
  }
  if (call.status === 401 || call.status === 403) return "key_refused";
  if (call.status === 404) return "model_not_found";
  if (call.status === 400 || call.status === 422) {
    const said = JSON.stringify(call.refusal ?? "").toLowerCase();
    if (/image|vision|modalit/.test(said)) return "no_image_input";
    if (/model/.test(said)) return "model_not_found";
    if (/schema|json|response_format|output/.test(said)) return "bad_output";
  }
  return "call_failed";
}

/** How a settings request ended; the body carries the same code. */
export type SettingsOutcome =
  | { readonly kind: "saved"; readonly configurationId?: number }
  | {
    readonly kind:
      | "bad_request"
      | "unauthenticated"
      | "forbidden"
      | "reauth"
      | "no_key"
      | CheckFailure;
  };

export type SettingsDeps = {
  readonly supabase: SupabaseDeps;
  readonly keys: Keys;
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly modelTimeoutMs: number;
};

/** Reads the admin's id and session for a settings request, or the outcome that refuses it. */
async function admin(
  request: Request,
  deps: SettingsDeps,
  needsRecentSignIn: boolean,
): Promise<{ readonly id: UserId } | SettingsOutcome> {
  const authorization = request.headers.get("Authorization");
  const id = await authenticate(authorization, deps.supabase);
  const token = authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (id === null || token === undefined) return { kind: "unauthenticated" };
  const session = await adminSession(token, deps.supabase);
  if (session === "not_admin") return { kind: "forbidden" };
  if (needsRecentSignIn && session === "stale") return { kind: "reauth" };
  return { id };
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  const value: unknown = await request.json().catch(() => null);
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function target(
  value: Record<string, unknown>,
): { readonly provider: Provider; readonly model: ModelId } | null {
  const provider = parseProvider(value.provider);
  const model = provider !== null && typeof value.model === "string"
    ? modelId(provider, value.model.trim())
    : null;
  return provider === null || model === null ? null : { provider, model };
}

function extractDeps(
  provider: Provider,
  apiKey: string,
  deps: SettingsDeps,
): ExtractDeps {
  return {
    provider,
    apiKey,
    fetch: deps.fetch,
    now: deps.now,
    timeoutMs: deps.modelTimeoutMs,
  };
}

/**
 * `POST settings/key` with `{provider, key, model}`: an admin who signed in within 10 minutes
 * saves [key] as the provider's, after the check call with it and [model] parsed. A key that
 * fails is not stored, so a key in use is never replaced by one that fails.
 */
export async function saveKey(
  request: Request,
  deps: SettingsDeps,
): Promise<SettingsOutcome> {
  const caller = await admin(request, deps, true);
  if (!("id" in caller)) return caller;
  const value = await body(request);
  const chosen = value === null ? null : target(value);
  const key = typeof value?.key === "string" ? value.key.trim() : "";
  if (
    chosen === null || key.length < 8 || key.length > 1000 || /\s/.test(key)
  ) {
    return { kind: "bad_request" };
  }
  const failure = await checkCall(
    chosen.model,
    extractDeps(chosen.provider, key, deps),
  );
  if (failure !== null) return { kind: failure };
  if (!await saveProviderKey(caller.id, chosen.provider, key, deps.supabase)) {
    return { kind: "bad_request" };
  }
  deps.keys.forget(chosen.provider);
  return { kind: "saved" };
}

/** A prompt version's id as a request names it: a whole number from 1, as the database numbers them. */
function versionId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

/**
 * `POST settings/configuration` with `{plan, provider, model, prompt_version_id?}`: an admin saves
 * them as the plan's one draft, served to admins, after the check call with the provider's key in
 * use parsed. Without a prompt version the draft keeps the one it had, or else the active one's.
 */
export async function saveDraft(
  request: Request,
  deps: SettingsDeps,
): Promise<SettingsOutcome> {
  const caller = await admin(request, deps, false);
  if (!("id" in caller)) return caller;
  const value = await body(request);
  const chosen = value === null ? null : target(value);
  const plan = parsePlan(value?.plan);
  const named = value?.prompt_version_id;
  const prompt = named === undefined ? undefined : versionId(named);
  if (chosen === null || plan === null || prompt === null) {
    return { kind: "bad_request" };
  }
  const key = await deps.keys.get(chosen.provider);
  if (key === null) return { kind: "no_key" };
  const failure = await checkCall(
    chosen.model,
    extractDeps(chosen.provider, key, deps),
  );
  if (failure !== null) return { kind: failure };
  const configurationId = await saveConfiguration(
    caller.id,
    plan,
    chosen.provider,
    chosen.model,
    prompt,
    deps.supabase,
  );
  if (configurationId === null) return { kind: "bad_request" };
  return { kind: "saved", configurationId };
}

export function settingsStatus(outcome: SettingsOutcome): number {
  switch (outcome.kind) {
    case "saved":
      return 200;
    case "bad_request":
      return 400;
    case "unauthenticated":
      return 401;
    case "forbidden":
    case "reauth":
      return 403;
    case "no_key":
      return 409;
    case "key_refused":
    case "model_not_found":
    case "no_image_input":
    case "bad_output":
    case "call_failed":
      return 422;
  }
}
