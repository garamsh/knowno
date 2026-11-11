/**
 * The admin area's assistant settings (ADR 0195): a plan's assistant configuration saved as its
 * one draft only after one call with it through its provider's adapter streamed to its end, as
 * extract-cards' `settings/configuration` saves a photo configuration (ADR 0182).
 */

import {
  authenticate,
  type SupabaseDeps,
  SupabaseError,
  type UserId,
} from "../_shared/auth.ts";
import { type Keys, PROVIDERS } from "../_shared/keys.ts";
import { type Answer, type Call, refusal } from "./answer.ts";
import { ADAPTERS, sseEvents, StreamError } from "./providers.ts";
import {
  type Draft,
  effortFits,
  EFFORTS,
  isAdmin,
  saveConfiguration,
} from "./supabase.ts";
import { ASSISTANT_TOOLS } from "./tools.ts";

/** The plans an assistant configuration serves, as `private.assistant_configurations` names them. */
const PLANS = ["free", "pro", "max", "special"] as const;

/** The check call's instructions, and how long it may take. */
export const CHECK_PROMPT = "Answer with the one word 네. Call no tool.";
export const CHECK_TIMEOUT_MS = 30_000;

/** Why a check call failed, named as extract-cards names the same failures. */
export type CheckFailure = "key_refused" | "model_not_found" | "call_failed";

/** How a settings request ended; the body carries the same code. */
export type SettingsOutcome =
  | { readonly kind: "saved"; readonly configurationId: number }
  | {
    readonly kind:
      | "bad_request"
      | "effort_unsupported"
      | "unauthenticated"
      | "forbidden"
      | "no_key"
      | CheckFailure;
  };

export type SettingsDeps = {
  readonly supabase: SupabaseDeps;
  readonly keys: Keys;
  readonly fetch: typeof fetch;
  readonly timeout: (ms: number) => AbortSignal;
};

/** A model id in its provider's form, as `private.model_fits` checks it. */
function fits(provider: Draft["provider"], model: string): boolean {
  const form = provider === "openrouter"
    ? /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:-]+$/
    : /^[A-Za-z0-9_.:-]+$/;
  return form.test(model) && model.length <= 200;
}

/** The draft a request body names, or null when it names none. */
function readDraft(value: unknown): Draft | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const body = value as Record<string, unknown>;
  const plan = PLANS.find((known) => known === body.plan);
  const provider = PROVIDERS.find((known) => known === body.provider);
  const effort = EFFORTS.find((known) => known === body.reasoning_effort);
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const prompt = body.prompt_version_id;
  const searches = body.max_searches;
  if (
    plan === undefined || provider === undefined || effort === undefined ||
    !fits(provider, model) || typeof body.web_search !== "boolean" ||
    typeof searches !== "number" || !Number.isInteger(searches) ||
    searches < 1 || searches > 10 ||
    (prompt !== undefined &&
      (typeof prompt !== "number" || !Number.isSafeInteger(prompt) ||
        prompt < 1))
  ) {
    return null;
  }
  return {
    plan,
    provider,
    model,
    promptVersionId: prompt as number | undefined,
    webSearch: body.web_search,
    maxSearches: searches,
    effort,
  };
}

/**
 * One call with [draft]'s provider, model, tools, web search and effort through its adapter,
 * read to its end: null when it answered, the failure otherwise. A refusal's body is read only
 * to name the failure.
 */
export async function checkCall(
  draft: Draft,
  apiKey: string,
  deps: SettingsDeps,
): Promise<CheckFailure | null> {
  const adapter = ADAPTERS[draft.provider];
  let response;
  try {
    response = await deps.fetch(adapter.url, {
      method: "POST",
      signal: deps.timeout(CHECK_TIMEOUT_MS),
      headers: adapter.headers(apiKey),
      body: JSON.stringify(adapter.body({
        configuration: {
          id: 0,
          provider: draft.provider,
          model: draft.model,
          promptVersionId: 0,
          prompt: CHECK_PROMPT,
          webSearch: draft.webSearch,
          maxSearches: draft.maxSearches,
          effort: draft.effort,
        },
        system: CHECK_PROMPT,
        messages: adapter.history([{ role: "user", text: "안녕" }]),
        tools: ASSISTANT_TOOLS,
      })),
    });
  } catch (error) {
    if (error instanceof TypeError || error instanceof DOMException) {
      return "call_failed";
    }
    throw error;
  }
  if (!response.ok || response.body === null) {
    const said = (await response.text().catch(() => "")).toLowerCase();
    if (response.status === 401 || response.status === 403) {
      return "key_refused";
    }
    if (response.status === 404) return "model_not_found";
    if (
      (response.status === 400 || response.status === 422) && /model/.test(said)
    ) {
      return "model_not_found";
    }
    return "call_failed";
  }
  try {
    await adapter.read(sseEvents(response.body), () => {});
  } catch (error) {
    if (error instanceof StreamError) return "call_failed";
    throw error;
  }
  return null;
}

/**
 * `POST /assistant/settings/configuration` with `{plan, provider, model, prompt_version_id?,
 * web_search, max_searches, reasoning_effort}`: an admin saves them as the plan's one draft, served
 * to admins, after the check call with the provider's key in use answered. A model that cannot
 * run at the effort is refused before the call. Without a prompt version the draft keeps the one
 * it had, or else the active one's.
 */
export async function saveDraft(
  request: Request,
  deps: SettingsDeps,
): Promise<SettingsOutcome> {
  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer (\S+)$/)?.[1];
  const id: UserId | null = token === undefined
    ? null
    : await authenticate(authorization, deps.supabase);
  if (id === null || token === undefined) return { kind: "unauthenticated" };
  if (!await isAdmin(token, deps.supabase)) return { kind: "forbidden" };
  const draft = readDraft(await request.json().catch(() => null));
  if (draft === null) return { kind: "bad_request" };
  if (!await effortFits(draft, deps.supabase)) {
    return { kind: "effort_unsupported" };
  }
  const key = await deps.keys.get(draft.provider);
  if (key === null) return { kind: "no_key" };
  const failure = await checkCall(draft, key, deps);
  if (failure !== null) return { kind: failure };
  const configurationId = await saveConfiguration(id, draft, deps.supabase);
  if (configurationId === null) return { kind: "bad_request" };
  return { kind: "saved", configurationId };
}

export function settingsStatus(outcome: SettingsOutcome): number {
  switch (outcome.kind) {
    case "saved":
      return 200;
    case "bad_request":
    case "effort_unsupported":
      return 400;
    case "unauthenticated":
      return 401;
    case "forbidden":
      return 403;
    case "no_key":
      return 409;
    case "key_refused":
    case "model_not_found":
    case "call_failed":
      return 422;
  }
}

/** `POST /assistant/settings/configuration`: [saveDraft] answered as the route does. */
export async function settingsRequest(call: Call): Promise<Answer> {
  const { request, deps, service, entry } = call;
  let outcome;
  try {
    outcome = await saveDraft(request, {
      supabase: service,
      keys: deps.keys,
      fetch: deps.fetch,
      timeout: deps.timeout,
    });
  } catch (error) {
    if (error instanceof SupabaseError) {
      return refusal(503, "unavailable", entry);
    }
    throw error;
  }
  return {
    response: Response.json(
      outcome.kind === "saved"
        ? { saved: true, configuration_id: outcome.configurationId }
        : { error: outcome.kind },
      { status: settingsStatus(outcome) },
    ),
    entry: { ...entry, outcome: outcome.kind },
  };
}
