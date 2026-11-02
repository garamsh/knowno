/**
 * The AI providers a plan's configuration may name (ADR 0162), and how one model call is sent to
 * each and its answer read: OpenRouter's and OpenAI's chat completions, and Anthropic's messages.
 */

import type { ModelId, ReplyForm, Usage } from "./model.ts";
import { userPrompt } from "./prompt_v8.ts";
import type { Image, LanguageHints } from "./request.ts";

export const PROVIDERS = ["openrouter", "openai", "anthropic"] as const;
export type Provider = (typeof PROVIDERS)[number];

export function parseProvider(value: unknown): Provider | null {
  return PROVIDERS.find((known) => known === value) ?? null;
}

/** What one model call asks for, which an adapter puts in its provider's request. */
export type ModelRequest = {
  readonly model: ModelId;
  readonly instructions: string;
  readonly image: Image;
  readonly languages: LanguageHints;
  readonly form: ReplyForm;
  readonly followUp?: string;
};

/** A successful answer's message text, and whether it stopped at the output cap. */
export type ReplyText = { readonly text: string; readonly cut: boolean };

/** How a provider is called and its answer read; the call itself, its timeout included, is shared. */
export type Adapter = {
  readonly url: string;
  readonly headers: (apiKey: string) => Record<string, string>;
  readonly body: (request: ModelRequest) => unknown;
  /** The reply's text, or null when a successful answer carries none. */
  readonly reply: (body: unknown) => ReplyText | null;
  /** What the call used, or null when the answer reports nothing usable. */
  readonly usage: (body: unknown) => Usage | null;
};

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/** The schema keywords each provider's structured outputs refuse; the parser still checks them. */
const UNSUPPORTED: Readonly<Record<Provider, readonly string[]>> = {
  openrouter: [],
  // developers.openai.com/api/docs/guides/structured-outputs, "Supported schemas", read 2026-11-03.
  openai: ["minLength", "maxLength"],
  // The structured outputs' JSON schema limitations, Claude API docs, read 2026-11-03.
  anthropic: ["minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum"],
};

/** [schema] without the keywords [provider]'s structured outputs refuse. */
export function schemaFor(provider: Provider, schema: unknown): unknown {
  const drop = new Set(UNSUPPORTED[provider]);
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.entries(value).filter(([key]) => !drop.has(key)).map((
        [key, inner],
      ) => [key, key === "enum" ? inner : strip(inner)]),
    );
  };
  return drop.size === 0 ? schema : strip(schema);
}

/** The user turn every provider sends: the language hints, the photo, then any follow-up text. */
function chatContent(request: ModelRequest): unknown[] {
  return [
    { type: "text", text: userPrompt(request.languages) },
    {
      type: "image_url",
      image_url: {
        url: `data:${request.image.type};base64,${request.image.base64}`,
      },
    },
    ...(request.followUp === undefined
      ? []
      : [{ type: "text", text: request.followUp }]),
  ];
}

function chatMessages(request: ModelRequest): unknown[] {
  return [
    { role: "system", content: request.instructions },
    { role: "user", content: chatContent(request) },
  ];
}

function jsonSchemaFormat(provider: Provider, form: ReplyForm): unknown {
  return {
    type: "json_schema",
    json_schema: {
      name: "cards",
      strict: true,
      schema: schemaFor(provider, form.schema),
    },
  };
}

/** The first choice's message text of a chat completion, cut when it finished at the cap. */
function chatReply(body: unknown): ReplyText | null {
  if (!isRecord(body) || !Array.isArray(body.choices)) return null;
  const choice: unknown = body.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return null;
  return typeof choice.message.content === "string"
    ? { text: choice.message.content, cut: choice.finish_reason === "length" }
    : null;
}

/** A chat completion's usage; OpenAI reports no cost, so its cost is null. */
function chatUsage(body: unknown): Usage | null {
  if (!isRecord(body) || !isRecord(body.usage)) return null;
  const { prompt_tokens, completion_tokens, cost, cost_details } = body.usage;
  if (
    typeof prompt_tokens !== "number" || typeof completion_tokens !== "number"
  ) return null;
  // A call billed through the owner's own provider key (BYOK) reports the provider's price here,
  // and only OpenRouter's own fee in `cost`.
  const upstream = isRecord(cost_details)
    ? cost_details.upstream_inference_cost
    : undefined;
  const parts = [cost, upstream].filter((part) => typeof part === "number");
  return {
    promptTokens: prompt_tokens,
    completionTokens: completion_tokens,
    costUsd: parts.length === 0
      ? null
      : parts.reduce((total, part) => total + part, 0),
  };
}

const openrouter: Adapter = {
  url: OPENROUTER_URL,
  headers: (apiKey) => ({
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  }),
  body: (request) => ({
    model: request.model,
    messages: chatMessages(request),
    response_format: jsonSchemaFormat("openrouter", request.form),
    // Route only to providers that honour the schema rather than ignore it.
    provider: { require_parameters: true },
    max_tokens: request.form.maxTokens,
  }),
  reply: chatReply,
  usage: chatUsage,
};

const openai: Adapter = {
  url: OPENAI_URL,
  headers: (apiKey) => ({
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  }),
  body: (request) => ({
    model: request.model,
    messages: chatMessages(request),
    response_format: jsonSchemaFormat("openai", request.form),
    max_completion_tokens: request.form.maxTokens,
  }),
  reply: chatReply,
  usage: chatUsage,
};

const anthropic: Adapter = {
  url: ANTHROPIC_URL,
  headers: (apiKey) => ({
    "x-api-key": apiKey,
    "anthropic-version": "2026-10-21",
    "Content-Type": "application/json",
  }),
  body: (request) => ({
    model: request.model,
    max_tokens: request.form.maxTokens,
    system: request.instructions,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: userPrompt(request.languages) },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: request.image.type,
            data: request.image.base64,
          },
        },
        ...(request.followUp === undefined
          ? []
          : [{ type: "text", text: request.followUp }]),
      ],
    }],
    output_config: {
      format: {
        type: "json_schema",
        schema: schemaFor("anthropic", request.form.schema),
      },
    },
  }),
  reply: (body) => {
    if (!isRecord(body) || !Array.isArray(body.content)) return null;
    const text = body.content.find((block: unknown) =>
      isRecord(block) && block.type === "text" && typeof block.text === "string"
    );
    return isRecord(text) && typeof text.text === "string"
      ? { text: text.text, cut: body.stop_reason === "max_tokens" }
      : null;
  },
  usage: (body) => {
    if (!isRecord(body) || !isRecord(body.usage)) return null;
    const { input_tokens, output_tokens } = body.usage;
    return typeof input_tokens === "number" &&
        typeof output_tokens === "number"
      ? {
        promptTokens: input_tokens,
        completionTokens: output_tokens,
        costUsd: null,
      }
      : null;
  },
};

export const ADAPTERS: Readonly<Record<Provider, Adapter>> = {
  openrouter,
  openai,
  anthropic,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
