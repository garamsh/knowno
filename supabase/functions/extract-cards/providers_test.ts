// The three providers' adapters, each through extractCards against a recorded answer of its own
// shape, with no network.
import assert from "node:assert/strict";
import { cardsSchema } from "./cards.ts";
import { extractCards, type ModelId, modelId } from "./model.ts";
import {
  ANTHROPIC_URL,
  OPENAI_URL,
  OPENROUTER_URL,
  type Provider,
  schemaFor,
} from "./providers.ts";
import type { Image } from "./request.ts";

const PHOTO: Image = { type: "image/png", base64: "iVBORw0KGgo=" };
const KEY = "sk-provider-key-1234";
const card = {
  kind: "vocabulary",
  type: "concept",
  front: "apple",
  answer: null,
  topic: "Fruit",
  senses: [{ labels: [], meaning: "사과", examples: [] }],
  extras: [],
  pronunciation: null,
  examples: [],
  table: null,
  cloze: null,
};
const reply = JSON.stringify({ cards: [card] });

/** Each provider's recorded answer: a whole reply, and one cut at the output cap. */
const answers: Record<Provider, (cut: boolean) => unknown> = {
  openrouter: (cut) => ({
    choices: [{
      finish_reason: cut ? "length" : "stop",
      message: { content: reply },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 },
  }),
  openai: (cut) => ({
    choices: [{
      finish_reason: cut ? "length" : "stop",
      message: { content: reply, refusal: null },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }),
  anthropic: (cut) => ({
    content: [{ type: "thinking", thinking: "" }, {
      type: "text",
      text: reply,
    }],
    stop_reason: cut ? "max_tokens" : "end_turn",
    usage: { input_tokens: 10, output_tokens: 5 },
  }),
};

const urls: Record<Provider, string> = {
  openrouter: OPENROUTER_URL,
  openai: OPENAI_URL,
  anthropic: ANTHROPIC_URL,
};

const models: Record<Provider, string> = {
  openrouter: "anthropic/claude-haiku-5.5",
  openai: "gpt-model",
  anthropic: "claude-haiku-5-5",
};

async function call(provider: Provider, cut = false) {
  const sent: {
    url: string;
    headers: Headers;
    body: Record<string, unknown>;
  }[] = [];
  const extraction = await extractCards(
    PHOTO,
    {},
    modelId(provider, models[provider]) as ModelId,
    "instructions",
    {
      provider,
      apiKey: KEY,
      now: () => 0,
      timeoutMs: 1000,
      fetch: (input, init) => {
        sent.push({
          url: String(input),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        return Promise.resolve(Response.json(answers[provider](cut)));
      },
    },
  );
  return { extraction, sent };
}

/** Every key name anywhere in [value]. */
function keysIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysIn);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap((
    [key, inner],
  ) => [key, ...keysIn(inner)]);
}

Deno.test("each provider is called at its own address with its key and the model, and its reply read into cards", async () => {
  for (const provider of ["openrouter", "openai", "anthropic"] as const) {
    const { extraction, sent } = await call(provider);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, urls[provider], provider);
    assert.equal(sent[0].body.model, models[provider]);
    const auth = provider === "anthropic"
      ? sent[0].headers.get("x-api-key")
      : sent[0].headers.get("Authorization");
    assert.equal(auth, provider === "anthropic" ? KEY : `Bearer ${KEY}`);
    assert.equal(extraction.kind, "cards", provider);
    assert.equal(
      extraction.kind === "cards" ? extraction.cards[0].front : null,
      "apple",
    );
    assert.equal(extraction.attempts[0].usage?.promptTokens, 10, provider);
  }
});

Deno.test("each provider sends the image, the instructions and the strict schema in its own form", async () => {
  const openrouter = (await call("openrouter")).sent[0].body;
  assert.deepEqual(openrouter.provider, { require_parameters: true });
  assert.equal(openrouter.max_tokens, 16384);
  assert.deepEqual(
    (openrouter.response_format as { json_schema: { schema: unknown } })
      .json_schema.schema,
    cardsSchema,
    "OpenRouter takes the whole schema",
  );

  const openai = (await call("openai")).sent[0].body;
  assert.equal(openai.max_completion_tokens, 16384);
  assert.equal(openai.provider, undefined, "no OpenRouter routing field");
  const openaiFormat = openai.response_format as {
    json_schema: { strict: boolean; schema: unknown };
  };
  assert.equal(openaiFormat.json_schema.strict, true);
  assert.ok(
    JSON.stringify(openai.messages).includes(
      "data:image/png;base64,iVBORw0KGgo=",
    ),
  );

  const anthropic = (await call("anthropic")).sent[0].body;
  const content = JSON.stringify(anthropic.messages);
  assert.ok(content.includes('"type":"base64"'), "the image as a base64 block");
  assert.ok(content.includes('"data":"iVBORw0KGgo="'));
  assert.ok(
    typeof anthropic.system === "string" &&
      anthropic.system.startsWith("instructions"),
  );
  const format =
    (anthropic.output_config as { format: { type: string } }).format;
  assert.equal(format.type, "json_schema");
});

Deno.test("each provider's schema leaves out only the keywords its structured outputs refuse", () => {
  const whole = keysIn(cardsSchema);
  assert.ok(
    whole.includes("minLength") && whole.includes("maxItems"),
    "control",
  );
  const openai = keysIn(schemaFor("openai", cardsSchema));
  assert.ok(!openai.includes("minLength") && !openai.includes("maxLength"));
  assert.ok(openai.includes("maxItems"), "OpenAI keeps array sizes");
  const anthropic = keysIn(schemaFor("anthropic", cardsSchema));
  for (const dropped of ["minLength", "maxLength", "maxItems", "minItems"]) {
    assert.ok(!anthropic.includes(dropped), dropped);
  }
  assert.ok(
    anthropic.includes("additionalProperties"),
    "the strict shape stays",
  );
  assert.deepEqual(schemaFor("openrouter", cardsSchema), cardsSchema);
});

Deno.test("each provider's reply stopped at the output cap is read as cut, against a whole one", async () => {
  for (const provider of ["openrouter", "openai", "anthropic"] as const) {
    const cut = (await call(provider, true)).extraction;
    assert.equal(
      cut.kind === "cards" && cut.cut,
      false,
      "a whole JSON reply is not cut",
    );
  }
  const anthropicCut = await extractCards(
    PHOTO,
    {},
    modelId("anthropic", "claude-haiku-5-5") as ModelId,
    "instructions",
    {
      provider: "anthropic",
      apiKey: KEY,
      now: () => 0,
      timeoutMs: 1000,
      fetch: () =>
        Promise.resolve(Response.json({
          content: [{ type: "text", text: `${reply.slice(0, -2)},{"kind":` }],
          stop_reason: "max_tokens",
          usage: { input_tokens: 1, output_tokens: 1 },
        })),
    },
  );
  assert.equal(
    anthropicCut.kind,
    "cards",
    "the completed card is kept from a cut reply",
  );
  assert.equal(anthropicCut.kind === "cards" && anthropicCut.cut, true);
  const ended = await extractCards(
    PHOTO,
    {},
    modelId("anthropic", "claude-haiku-5-5") as ModelId,
    "instructions",
    {
      provider: "anthropic",
      apiKey: KEY,
      now: () => 0,
      timeoutMs: 1000,
      fetch: () =>
        Promise.resolve(Response.json({
          content: [{ type: "text", text: `${reply.slice(0, -2)},{"kind":` }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        })),
    },
  );
  assert.equal(
    ended.kind,
    "invalid_output",
    "control: the same text not at the cap is invalid",
  );
});

Deno.test("a model id takes its provider's form", () => {
  assert.notEqual(modelId("openrouter", "anthropic/claude-haiku-5.5"), null);
  assert.equal(modelId("openrouter", "claude-haiku-5-5"), null);
  assert.notEqual(modelId("anthropic", "claude-haiku-5-5"), null);
  assert.equal(modelId("openai", "openai/gpt-model"), null);
  assert.equal(modelId("openai", "gpt model"), null);
});
