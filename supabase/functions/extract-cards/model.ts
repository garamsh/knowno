/** Extracts cards from an image through one model call to the provider a configuration names. */

import {
  type Card,
  type CardRule,
  cardsSchema,
  closeCutReply,
  composeInstructions,
  OUTPUT_CONTRACT,
  type ParsedReply,
  parseReply,
} from "./cards.ts";
import { ADAPTERS, type ModelRequest, type Provider } from "./providers.ts";
import type { Image, LanguageHints } from "./request.ts";

// Bounds one call's cost; a reply cut off at it keeps the cards it completed (ADR 0135).
export const MAX_OUTPUT_TOKENS = 16384;
/**
 * How long one model call may take, its reply's body included, before it is abandoned as a model
 * error: four times the p90 of 15.6 s measured on 2026-10-28, under the Edge Function's 150 s
 * request idle timeout and wall clock (ADR 0124).
 */
export const MODEL_TIMEOUT_MS = 60_000;

/**
 * A provider's model ID: OpenRouter's `vendor/model`, such as `anthropic/claude-haiku-5.5`, or
 * OpenAI's and Anthropic's bare one, such as `claude-haiku-5-5`, as `private.model_fits` checks it.
 */
export type ModelId = string & { readonly __brand: "ModelId" };

export function modelId(provider: Provider, value: string): ModelId | null {
  const form = provider === "openrouter" ? /^[\w.-]+\/[\w.:-]+$/ : /^[\w.:-]+$/;
  return form.test(value) && value.length <= 200 ? value as ModelId : null;
}

/**
 * What the provider reported for one call; `costUsd` is null when it reported no cost, and
 * otherwise the call's whole price: OpenRouter's `cost` plus the provider's `upstream_inference_cost`.
 */
export type Usage = {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsd: number | null;
};

/**
 * One model call: the model, how long it took, its usage when the reply carried one, and whether
 * it was abandoned at its timeout.
 */
export type Attempt = {
  readonly model: ModelId;
  readonly latencyMs: number;
  readonly usage: Usage | null;
  readonly timedOut: boolean;
};

/**
 * How a call ended. `dropped` names the rule each dropped card broke: on `cards`, the cards the
 * reply returned beside those kept; on `invalid_output`, every card of a reply that kept none.
 * `cut` is whether the reply was cut off at the output cap, so only the cards it completed were read.
 */
export type Extraction =
  | {
    readonly kind: "cards";
    readonly cards: readonly Card[];
    readonly dropped: readonly CardRule[];
    readonly cut: boolean;
    readonly attempts: readonly Attempt[];
  }
  | { readonly kind: "no_cards"; readonly attempts: readonly Attempt[] }
  | {
    readonly kind: "invalid_output";
    readonly dropped: readonly CardRule[];
    readonly cut: boolean;
    readonly attempts: readonly Attempt[];
  }
  | { readonly kind: "model_error"; readonly attempts: readonly Attempt[] };

/**
 * What a call asks the model for and how its reply is read: the reply's JSON schema, the output
 * contract sent after the prompt, the parser of a whole reply, and the most tokens the reply may
 * take. The function sends `CARD_LIST`; the eval measures other forms through it (ADR 0135).
 */
export type ReplyForm = {
  readonly schema: unknown;
  readonly contract: string;
  readonly parse: (reply: string) => ParsedReply | null;
  readonly maxTokens: number;
};

/** The card list of `cardsSchema`, read by `parseReply`, up to `MAX_OUTPUT_TOKENS`. */
export const CARD_LIST: ReplyForm = {
  schema: cardsSchema,
  contract: OUTPUT_CONTRACT,
  parse: parseReply,
  maxTokens: MAX_OUTPUT_TOKENS,
};

/**
 * How a call departs from the function's own: its reply's form, and a text sent after the photo,
 * such as a request to go on after the entry an earlier reply was cut at.
 */
export type CallOptions = {
  readonly form?: ReplyForm;
  readonly followUp?: string;
};

export type ExtractDeps = {
  /** The provider called, and its key, which nothing logs or returns. */
  readonly provider: Provider;
  readonly apiKey: string;
  readonly fetch: typeof fetch;
  /** Milliseconds from a monotonic clock. */
  readonly now: () => number;
  /** How long the call may take before it is a model error, `MODEL_TIMEOUT_MS` when deployed. */
  readonly timeoutMs: number;
};

/**
 * One call to [model] with [prompt] and then the output contract as the system prompt. A card that
 * breaks a rule is dropped; output that is not the schema's, or whose every card is dropped, is
 * `invalid_output`, with no second call. A reply cut off at the output cap keeps the cards its JSON
 * completed before the cut.
 */
export async function extractCards(
  image: Image,
  languages: LanguageHints,
  model: ModelId,
  prompt: string,
  deps: ExtractDeps,
  options: CallOptions = {},
): Promise<Extraction> {
  const form = options.form ?? CARD_LIST;
  const call = await callModel({
    model,
    instructions: composeInstructions(prompt, form.contract),
    image,
    languages,
    form,
    followUp: options.followUp,
  }, deps);
  const attempts = [call.attempt];
  if (call.reply === null) return { kind: "model_error", attempts };
  const whole = form.parse(call.reply);
  // A reply that reached the cap with its JSON whole was not cut short.
  const cut = whole === null && call.cut;
  const closed = cut ? closeCutReply(call.reply) : null;
  const parsed = whole ?? (closed === null ? null : form.parse(closed));
  if (parsed === null) {
    return { kind: "invalid_output", dropped: [], cut, attempts };
  }
  const { cards, dropped } = parsed;
  if (cards.length > 0) {
    return { kind: "cards", cards, dropped, cut, attempts };
  }
  return dropped.length === 0 && !cut
    ? { kind: "no_cards", attempts }
    : { kind: "invalid_output", dropped, cut, attempts };
}

/**
 * One call's attempt, its message text or null when the call failed, whether it hit the cap, the
 * answer's HTTP status, null when none arrived, and a refusal's body, which nothing logs or returns.
 */
export type Call = {
  readonly attempt: Attempt;
  readonly reply: string | null;
  readonly cut: boolean;
  readonly status: number | null;
  readonly refusal: unknown;
};

/** Sends one request through [provider]'s adapter; `reply` is null when the call itself failed. */
export async function callModel(
  request: ModelRequest,
  deps: ExtractDeps,
): Promise<Call> {
  const adapter = ADAPTERS[deps.provider];
  const started = deps.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Settles when the deadline passes, aborting the request; a fetch that ignores the abort is
  // still left behind.
  const deadline = new Promise<"timed_out">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timed_out");
    }, deps.timeoutMs);
  });
  const read = async (): Promise<Read> => {
    const response = await deps.fetch(adapter.url, {
      method: "POST",
      signal: controller.signal,
      headers: adapter.headers(deps.apiKey),
      body: JSON.stringify(adapter.body(request)),
    });
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, ok: response.ok, body };
  };
  let result: Read | "failed" | "timed_out";
  try {
    result = await Promise.race([read(), deadline]);
  } catch {
    result = "failed";
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = deps.now() - started;
  const model = request.model;
  if (result === "failed" || result === "timed_out") {
    return {
      attempt: {
        model,
        latencyMs,
        usage: null,
        timedOut: result === "timed_out",
      },
      reply: null,
      cut: false,
      status: null,
      refusal: null,
    };
  }
  const attempt = {
    model,
    latencyMs,
    usage: adapter.usage(result.body),
    timedOut: false,
  };
  if (!result.ok) {
    return {
      attempt,
      reply: null,
      cut: false,
      status: result.status,
      refusal: result.body,
    };
  }
  const message = adapter.reply(result.body);
  // A 200 whose body carries no message text is treated as invalid output.
  return {
    attempt,
    reply: message?.text ?? "",
    cut: message?.cut ?? false,
    status: result.status,
    refusal: null,
  };
}

/** A call's answer: its status, whether it was a success, and its body, null when not JSON. */
type Read = {
  readonly status: number;
  readonly ok: boolean;
  readonly body: unknown;
};
