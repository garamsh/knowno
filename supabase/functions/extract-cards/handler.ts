/** The extract-cards request pipeline and the mapping from each outcome to an HTTP status. */

import type { Card } from "./cards.ts";
import type { Config } from "./config.ts";
import {
  type Cursor,
  type CursorToken,
  encodeCursor,
  lastFronts,
  MAX_CONTINUATIONS,
  MAX_PHOTO_CARDS,
  type ReadOn,
  readOn,
  readsOn,
} from "./continuation.ts";
import {
  type Attempt,
  extractCards,
  type Extraction,
  type ModelId,
} from "./model.ts";
import type { Keys } from "./keys.ts";
import type { Provider } from "./providers.ts";
import { type ExtractRequest, parseRequest } from "./request.ts";
import {
  saveDraft,
  saveKey,
  type SettingsOutcome,
  settingsStatus,
} from "./settings.ts";
import { authenticate, type UserId } from "../_shared/auth.ts";
import {
  type AttemptFailure,
  beginExtraction,
  finishExtraction,
  type Period,
  type Plan,
  recordResumed,
  resumeExtraction,
  userSuspended,
} from "./supabase.ts";

/** How a request ended; the error body carries the same code, for the app to show. */
export type Outcome =
  | "ok"
  | "method_not_allowed"
  | "not_configured"
  | "unauthenticated"
  | "suspended"
  | "bad_request"
  | "too_large"
  | "unsupported_type"
  | "rate_limited"
  | "unavailable"
  | "cursor_expired"
  | "no_cards"
  | "model_error"
  | "internal";

/**
 * The one line logged per request. It carries these fields only: never the image, the
 * cards, the token, or a configuration value.
 */
export type LogEntry = {
  readonly user_id: UserId | null;
  /** The caller's plan, or null when it was not read. */
  readonly plan: Plan | null;
  /** The provider of the calls made, or null when none was. */
  readonly provider: Provider | null;
  /** The model of the call made, or null when none was. */
  readonly model: string | null;
  /** The id of the prompt version the call was made with, or null when none was made. */
  readonly prompt_version: number | null;
  readonly latency_ms: number;
  /** The call's usage; null when it made none or reported none. */
  readonly prompt_tokens: number | null;
  readonly completion_tokens: number | null;
  /** The reply's cards dropped for breaking a rule; null when no reply was read as the schema's. */
  readonly dropped_cards: number | null;
  /** Whether the photo's outcome was recorded; null when no photo was counted. */
  readonly outcome_recorded: boolean | null;
  readonly outcome: Outcome;
};

/** The one line logged per settings request: which, by whom, and how it ended; never a key. */
export type SettingsLogEntry = {
  readonly settings: "key" | "configuration";
  readonly outcome: SettingsOutcome["kind"] | "internal";
};

export type HandlerDeps = {
  readonly config: Config;
  readonly fetch: typeof fetch;
  readonly log: (entry: LogEntry | SettingsLogEntry) => void;
  /** The providers' keys, `vaultKeys` when deployed. */
  readonly keys: Keys;
  /** Milliseconds from a monotonic clock. */
  readonly now: () => number;
  /** How long the model call may take before it is a model error. */
  readonly modelTimeoutMs: number;
  /** A new cursor's token, `newCursorToken` when deployed. */
  readonly newToken: () => CursorToken;
};

/**
 * How long into a request a failed model call may still be retried (ADR 0130): a retry starting
 * by then ends, at the 60 s model timeout, by about 135 s, under the Edge Function's 150 s request
 * idle timeout and free plan's wall clock (`supabase.com/docs/guides/functions/limits`).
 */
export const RETRY_START_LIMIT_MS = 75_000;

export function status(outcome: Outcome): number {
  switch (outcome) {
    case "ok":
      return 200;
    case "bad_request":
      return 400;
    case "unauthenticated":
      return 401;
    case "suspended":
      return 403;
    case "method_not_allowed":
      return 405;
    case "too_large":
      return 413;
    case "unsupported_type":
      return 415;
    case "no_cards":
      return 422;
    case "cursor_expired":
      return 410;
    case "rate_limited":
      return 429;
    case "internal":
      return 500;
    case "model_error":
      return 502;
    case "not_configured":
    case "unavailable":
      return 503;
  }
}

type Result = {
  readonly outcome: Outcome;
  readonly userId: UserId | null;
  readonly plan?: Plan;
  readonly provider?: Provider;
  readonly promptVersion?: number;
  /** The photo limit and its period, which a `rate_limited` answer states. */
  readonly limit?: { readonly photos: number; readonly period: Period };
  readonly attempts: readonly Attempt[];
  readonly cards?: readonly Card[];
  /** Whether the page was left unread past the answered cards, so the photo was read in part. */
  readonly partial?: boolean;
  /** Where a later request goes on reading the photo, when it may. */
  readonly cursor?: Cursor;
  /** How many of the reply's cards were dropped, when a reply was read as the schema's. */
  readonly dropped?: number;
  /** Whether the counted photo's outcome was recorded. */
  readonly recorded?: boolean;
};

export function createHandler(
  deps: HandlerDeps,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const route = new URL(request.url).pathname.match(
      /\/settings\/(key|configuration)$/,
    )?.[1];
    if (route === "key" || route === "configuration") {
      return await settings(request, route, deps);
    }
    const started = deps.now();
    let result: Result;
    try {
      result = await handle(request, deps, started);
    } catch (error) {
      log(deps, started, { outcome: "internal", userId: null, attempts: [] });
      throw error;
    }
    log(deps, started, result);
    const body = result.outcome === "ok"
      ? {
        cards: result.cards,
        partial: result.partial ?? false,
        ...(result.cursor === undefined
          ? {}
          : { cursor: encodeCursor(result.cursor) }),
      }
      : result.outcome === "rate_limited"
      ? {
        error: result.outcome,
        photo_limit: result.limit?.photos,
        period: result.limit?.period,
      }
      : { error: result.outcome };
    return Response.json(body, { status: status(result.outcome) });
  };
}

async function handle(
  request: Request,
  deps: HandlerDeps,
  started: number,
): Promise<Result> {
  const refused = (outcome: Outcome, userId: UserId | null = null): Result => ({
    outcome,
    userId,
    attempts: [],
  });
  if (request.method !== "POST") return refused("method_not_allowed");
  const config = deps.config;
  if (config.kind === "not_configured") return refused("not_configured");

  const supabase = {
    url: config.supabaseUrl,
    serviceRoleKey: config.serviceRoleKey,
    fetch: deps.fetch,
  };
  const userId = await authenticate(
    request.headers.get("Authorization"),
    supabase,
  );
  if (userId === null) return refused("unauthenticated");

  const parsed = await parseRequest(request.body);
  if (!parsed.ok) return refused(parsed.failure, userId);
  if (await userSuspended(userId, supabase)) {
    return refused("suspended", userId);
  }
  if (parsed.request.cursor !== null) {
    return await resume(parsed.request, parsed.request.cursor, userId, {
      deps,
      config,
      started,
      supabase,
    });
  }
  const start = await beginExtraction(
    userId,
    parsed.request.configuration,
    supabase,
  );
  if (start.kind === "not_configured") return refused("not_configured", userId);
  if (start.kind === "unavailable") {
    return { ...refused("unavailable", userId), plan: start.plan };
  }
  if (start.kind === "rate_limited") {
    return {
      outcome: "rate_limited",
      userId,
      plan: start.plan,
      limit: { photos: start.photoLimit, period: start.period },
      attempts: [],
    };
  }
  const plan = start.plan;
  const promptVersion = start.prompt.versionId;
  const apiKey = await deps.keys.get(start.provider);
  // Only a key removed since begin_extraction read it; the photo stays counted with no outcome.
  if (apiKey === null) return { ...refused("unavailable", userId), plan };

  const extract = caller(parsed.request, start, apiKey, deps);
  const first = await extract();
  const firstFailure = failureOf(first);
  // A retry starts only early enough to end, at its own timeout, inside the Edge Function's limit.
  const retry = firstFailure !== null && mayStart(deps, started);
  const extraction = retry ? await extract() : first;
  const lastFailure = failureOf(extraction);
  const firstRead = extraction.kind === "cards" ? extraction.cards : [];
  const read = extraction.kind === "cards" ||
      extraction.kind === "invalid_output"
    ? extraction
    : null;
  // A cut reply, or a whole one of many cards, is read on after its last card, in this request
  // while time allows (ADR 0138).
  const on: ReadOn | null = extraction.kind === "cards" &&
      readsOn(extraction.cut, extraction.cards.length)
    ? await readOn(extract, {
      read: firstRead.length,
      fronts: lastFronts(firstRead.map((card) => card.front)),
      calls: MAX_CONTINUATIONS,
    }, () => mayStart(deps, started))
    : null;
  const cards = [...firstRead, ...(on?.cards ?? [])];
  const partial = on !== null && !on.done;
  const token = on !== null && !on.done && cards.length < MAX_PHOTO_CARDS &&
      on.calls < MAX_CONTINUATIONS
    ? deps.newToken()
    : null;
  const dropped = (read?.dropped.length ?? 0) + (on?.dropped.length ?? 0);
  const recorded = await finishExtraction(start.usageId, {
    outcome: extraction.kind === "cards" ? "ok" : extraction.kind,
    attempts: retry ? 2 : 1,
    latencyMs: deps.now() - started,
    cardsReturned: cards.length,
    cardsDropped: dropped,
    failures: [
      ...(retry && firstFailure !== null ? [firstFailure] : []),
      ...(lastFailure === null ? [] : [lastFailure]),
    ],
    truncated: extraction.kind === "cards" ? partial : read?.cut ?? false,
    continuations: on?.calls ?? 0,
    cursor: token,
  }, supabase);
  const attempts = [
    ...(retry ? first.attempts : []),
    ...extraction.attempts,
    ...(on?.attempts ?? []),
  ];
  const served = {
    userId,
    plan,
    provider: start.provider,
    promptVersion,
    attempts,
    recorded,
  };
  switch (extraction.kind) {
    case "cards":
      return {
        outcome: "ok",
        ...served,
        cards,
        partial,
        ...offered(token, recorded, cards.map((card) => card.front)),
        dropped,
      };
    case "no_cards":
      return { outcome: "no_cards", ...served, dropped: 0 };
    case "invalid_output":
      return {
        outcome: "model_error",
        ...served,
        ...(dropped === 0 ? {} : { dropped }),
      };
    case "model_error":
      return { outcome: "model_error", ...served };
  }
}

/**
 * A request that goes on reading a photo from [cursor] (ADR 0138), by the model and prompt version
 * of its first read; the photo is not counted again.
 */
async function resume(
  request: ExtractRequest,
  cursor: Cursor,
  userId: UserId,
  context: {
    readonly deps: HandlerDeps;
    readonly config: Configured;
    readonly started: number;
    readonly supabase: Parameters<typeof resumeExtraction>[2];
  },
): Promise<Result> {
  const { deps, started, supabase } = context;
  const resumed = await resumeExtraction(userId, cursor.token, supabase);
  if (resumed.kind !== "resumed") {
    return {
      outcome: resumed.kind === "refused" ? "cursor_expired" : "not_configured",
      userId,
      attempts: [],
    };
  }
  const apiKey = await deps.keys.get(resumed.provider);
  if (apiKey === null) {
    return { outcome: "unavailable", userId, plan: resumed.plan, attempts: [] };
  }
  const extract = caller(request, resumed, apiKey, deps);
  const on = await readOn(extract, {
    read: resumed.cardsRead,
    fronts: cursor.fronts,
    calls: MAX_CONTINUATIONS - resumed.continuations,
  }, () => mayStart(deps, started));
  const token = !on.done && !on.failed &&
      resumed.cardsRead + on.cards.length < MAX_PHOTO_CARDS &&
      resumed.continuations + on.calls < MAX_CONTINUATIONS
    ? deps.newToken()
    : null;
  const recorded = await recordResumed(resumed.usageId, {
    continuations: on.calls,
    cardsReturned: on.cards.length,
    truncated: !on.done,
    cursor: token,
  }, supabase);
  const served = {
    userId,
    plan: resumed.plan,
    provider: resumed.provider,
    promptVersion: resumed.prompt.versionId,
    attempts: on.attempts,
    recorded,
    dropped: on.dropped.length,
  };
  if (on.failed) return { outcome: "model_error", ...served };
  return {
    outcome: "ok",
    ...served,
    cards: on.cards,
    partial: !on.done,
    ...offered(token, recorded, [
      ...cursor.fronts,
      ...on.cards.map((card) => card.front),
    ]),
  };
}

type Configured = Extract<Config, { kind: "configured" }>;

/** The cursor an answer offers: none without a token, or when the record did not keep it. */
function offered(
  token: CursorToken | null,
  recorded: boolean,
  fronts: readonly string[],
): { readonly cursor?: Cursor } {
  return token === null || !recorded
    ? {}
    : { cursor: { token, fronts: lastFronts(fronts) } };
}

/**
 * One model call reading [request]'s photo with [serving]'s provider, model and prompt, asking
 * after the photo for [followUp] when given.
 */
function caller(
  request: ExtractRequest,
  serving: {
    readonly provider: Provider;
    readonly model: ModelId;
    readonly prompt: { readonly text: string };
  },
  apiKey: string,
  deps: HandlerDeps,
): (followUp?: string) => Promise<Extraction> {
  return (followUp) =>
    extractCards(
      request.image,
      request.languages,
      serving.model,
      serving.prompt.text,
      {
        provider: serving.provider,
        apiKey,
        fetch: deps.fetch,
        now: deps.now,
        timeoutMs: deps.modelTimeoutMs,
      },
      followUp === undefined ? {} : { followUp },
    );
}

/** A settings request (`settings.ts`), answered with its outcome's code and logged in one line. */
async function settings(
  request: Request,
  route: "key" | "configuration",
  deps: HandlerDeps,
): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const config = deps.config;
  if (config.kind === "not_configured") {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  const context = {
    supabase: {
      url: config.supabaseUrl,
      serviceRoleKey: config.serviceRoleKey,
      fetch: deps.fetch,
    },
    keys: deps.keys,
    fetch: deps.fetch,
    now: deps.now,
    modelTimeoutMs: deps.modelTimeoutMs,
  };
  let outcome: SettingsOutcome;
  try {
    outcome = route === "key"
      ? await saveKey(request, context)
      : await saveDraft(request, context);
  } catch (error) {
    deps.log({ settings: route, outcome: "internal" });
    throw error;
  }
  deps.log({ settings: route, outcome: outcome.kind });
  const body = outcome.kind === "saved"
    ? {
      saved: true,
      ...(outcome.configurationId === undefined
        ? {}
        : { configuration_id: outcome.configurationId }),
    }
    : { error: outcome.kind };
  return Response.json(body, { status: settingsStatus(outcome) });
}

/** Whether a model call may still start, early enough to end inside the Edge Function's limit. */
function mayStart(deps: HandlerDeps, started: number): boolean {
  return deps.now() - started < RETRY_START_LIMIT_MS;
}

/** How a model call failed, or null when it answered cards or a valid empty list. */
function failureOf(extraction: Extraction): AttemptFailure | null {
  switch (extraction.kind) {
    case "cards":
    case "no_cards":
      return null;
    case "invalid_output":
      return "invalid_output";
    case "model_error":
      return extraction.attempts.some((attempt) => attempt.timedOut)
        ? "timeout"
        : "model_error";
  }
}

function log(deps: HandlerDeps, started: number, result: Result): void {
  const usages = result.attempts.flatMap((attempt) =>
    attempt.usage === null ? [] : [attempt.usage]
  );
  const sum = (pick: (usage: (typeof usages)[number]) => number) =>
    usages.length === 0
      ? null
      : usages.reduce((total, usage) => total + pick(usage), 0);
  deps.log({
    user_id: result.userId,
    plan: result.plan ?? null,
    provider: result.provider ?? null,
    model: result.attempts.at(-1)?.model ?? null,
    prompt_version: result.promptVersion ?? null,
    latency_ms: Math.round(deps.now() - started),
    prompt_tokens: sum((usage) => usage.promptTokens),
    completion_tokens: sum((usage) => usage.completionTokens),
    dropped_cards: result.dropped ?? null,
    outcome_recorded: result.recorded ?? null,
    outcome: result.outcome,
  });
}
