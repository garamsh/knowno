/**
 * One text call to a provider for the triage (ADR 0244): the three providers' chat or messages
 * formats, a bounded answer, and what the call used and cost. A key is sent only to its provider
 * and appears in no log, error or answer.
 */

import type { Provider } from "../_shared/keys.ts";

const URLS: Record<Provider, string> = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

/** The most tokens an answer may take: the verdict is a short object. */
export const MAX_ANSWER_TOKENS = 300;

export type Call = {
  readonly provider: Provider;
  readonly model: string;
  readonly key: string;
  readonly instructions: string;
  readonly user: string;
  readonly fetch: typeof fetch;
  readonly timeoutMs: number;
};

/** An answer with its usage, or the status that refused it (null when it could not be reached). */
export type Answer =
  | {
    readonly kind: "answer";
    readonly text: string;
    /** The tokens the provider reports, null when its reply omits them. */
    readonly tokensIn: number | null;
    readonly tokensOut: number | null;
    /** The cost the provider reported, null when it reports none. */
    readonly costUsd: number | null;
  }
  | { readonly kind: "failed"; readonly status: number | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;

function request(
  call: Call,
): { headers: Record<string, string>; body: unknown } {
  if (call.provider === "anthropic") {
    return {
      headers: {
        "x-api-key": call.key,
        "anthropic-version": "2026-10-21",
        "Content-Type": "application/json",
      },
      body: {
        model: call.model,
        max_tokens: MAX_ANSWER_TOKENS,
        system: call.instructions,
        messages: [{ role: "user", content: call.user }],
      },
    };
  }
  const messages = [
    { role: "system", content: call.instructions },
    { role: "user", content: call.user },
  ];
  return {
    headers: {
      Authorization: `Bearer ${call.key}`,
      "Content-Type": "application/json",
    },
    body: call.provider === "openai"
      ? {
        model: call.model,
        messages,
        max_completion_tokens: MAX_ANSWER_TOKENS,
        response_format: { type: "json_object" },
      }
      : {
        model: call.model,
        messages,
        max_tokens: MAX_ANSWER_TOKENS,
        response_format: { type: "json_object" },
        usage: { include: true },
      },
  };
}

/** Reads a reply body of [provider]'s format into an answer, null when it holds no text. */
export function readAnswer(provider: Provider, body: unknown): Answer | null {
  if (!isRecord(body)) return null;
  const usage = isRecord(body.usage) ? body.usage : {};
  if (provider === "anthropic") {
    const block = Array.isArray(body.content) ? body.content[0] : undefined;
    if (!isRecord(block) || typeof block.text !== "string") return null;
    return {
      kind: "answer",
      text: block.text,
      tokensIn: count(usage.input_tokens),
      tokensOut: count(usage.output_tokens),
      costUsd: null,
    };
  }
  const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
  const message = isRecord(choice) ? choice.message : undefined;
  if (!isRecord(message) || typeof message.content !== "string") return null;
  return {
    kind: "answer",
    text: message.content,
    tokensIn: count(usage.prompt_tokens),
    tokensOut: count(usage.completion_tokens),
    costUsd: provider === "openrouter" && typeof usage.cost === "number" &&
        usage.cost >= 0
      ? usage.cost
      : null,
  };
}

/** One call; never throws for a provider's refusal, an unreachable provider or an unreadable body. */
export async function ask(call: Call): Promise<Answer> {
  const { headers, body } = request(call);
  const response = await call.fetch(URLS[call.provider], {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(call.timeoutMs),
  }).catch(() => null);
  if (response === null) return { kind: "failed", status: null };
  if (!response.ok) {
    await response.body?.cancel();
    return { kind: "failed", status: response.status };
  }
  const read = readAnswer(
    call.provider,
    await response.json().catch(() => null),
  );
  return read ?? { kind: "failed", status: response.status };
}
