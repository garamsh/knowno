// The cost a model call is recorded at, from the usage OpenRouter's reply reports.
import assert from "node:assert/strict";
import {
  extractCards,
  type Extraction,
  type ModelId,
  modelId,
} from "./model.ts";
import type { Image } from "./request.ts";

const MODEL = modelId("openrouter", "vendor/model") as ModelId;
const PHOTO: Image = { type: "image/png", base64: "AAAA" };
const CARD = {
  kind: "note",
  type: "concept",
  front: "연역 논증",
  answer: "전제가 참이면 결론이 반드시 참인 논증",
  topic: "연역과 귀납",
  senses: [],
  extras: [],
  pronunciation: null,
  examples: [],
  table: null,
  cloze: null,
};

/** One call answered with `body`, or with a failure when `status` is not 200. */
function extractWith(body: unknown, status = 200): Promise<Extraction> {
  return extractCards(PHOTO, {}, MODEL, "instructions", {
    provider: "openrouter",
    apiKey: "key",
    now: () => 0,
    fetch: () => Promise.resolve(Response.json(body, { status })),
    timeoutMs: 1000,
  });
}

const reply = (usage?: unknown) => ({
  choices: [{ message: { content: JSON.stringify({ cards: [CARD] }) } }],
  ...(usage === undefined ? {} : { usage }),
});

const costOf = async (usage?: unknown) =>
  (await extractWith(reply(usage))).attempts[0].usage?.costUsd;

Deno.test("a reply billed by OpenRouter records its cost", async () => {
  assert.equal(
    await costOf({ prompt_tokens: 1200, completion_tokens: 80, cost: 0.002 }),
    0.002,
  );
});

Deno.test("a BYOK reply records OpenRouter's cost plus the provider's upstream cost", async () => {
  const byok = {
    prompt_tokens: 1200,
    completion_tokens: 80,
    cost: 0,
    is_byok: true,
    cost_details: { upstream_inference_cost: 0.0023 },
  };
  assert.equal(await costOf(byok), 0.0023);
  assert.equal(
    await costOf({
      ...byok,
      cost: 0.0001,
      cost_details: { upstream_inference_cost: 0.0023 },
    }),
    0.0001 + 0.0023,
    "OpenRouter's own fee is kept beside the upstream price",
  );
});

Deno.test("cost details without an upstream cost leave the cost as reported", async () => {
  assert.equal(
    await costOf({
      prompt_tokens: 1,
      completion_tokens: 1,
      cost: 0.002,
      cost_details: {},
    }),
    0.002,
  );
});

Deno.test("a reply reporting no cost records none, and one without usage records no usage", async () => {
  assert.equal(await costOf({ prompt_tokens: 1, completion_tokens: 1 }), null);
  const failed = await extractWith({ error: { code: 503 } }, 503);
  assert.equal(failed.attempts[0].usage, null);
  const unreported = await extractWith(reply());
  assert.equal(unreported.attempts[0].usage, null);
  assert.equal(unreported.kind, "cards", "control: the reply itself is valid");
});

Deno.test("a call whose request or reply body never ends is a model error at its timeout, marked timed out", async () => {
  const deps = {
    provider: "openrouter" as const,
    apiKey: "key",
    now: () => 0,
    timeoutMs: 20,
  };
  const neverAnswers = await extractCards(PHOTO, {}, MODEL, "instructions", {
    ...deps,
    fetch: () => new Promise<Response>(() => {}),
  });
  // Headers arrive, but the body never finishes.
  const neverEnds = await extractCards(PHOTO, {}, MODEL, "instructions", {
    ...deps,
    fetch: () =>
      Promise.resolve(new Response(new ReadableStream({ start() {} }))),
  });
  for (const extraction of [neverAnswers, neverEnds]) {
    assert.equal(extraction.kind, "model_error");
    assert.equal(extraction.attempts.length, 1);
    assert.equal(extraction.attempts[0].timedOut, true);
    assert.equal(extraction.attempts[0].usage, null);
  }
  // Control: a call that fails at once is a model error not marked timed out.
  const refused = await extractCards(PHOTO, {}, MODEL, "instructions", {
    ...deps,
    fetch: () => Promise.reject(new TypeError("connection refused")),
  });
  assert.equal(refused.kind, "model_error");
  assert.equal(refused.attempts[0].timedOut, false);
});

Deno.test("a call aborts its request at the timeout", async () => {
  let signal: AbortSignal | null | undefined;
  await extractCards(PHOTO, {}, MODEL, "instructions", {
    provider: "openrouter",
    apiKey: "key",
    now: () => 0,
    timeoutMs: 20,
    fetch: (_input, init) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    },
  });
  assert.equal(signal?.aborted, true);
});

/** A reply of [cards] whose JSON stops partway into one more card, as a reply cut at the cap does. */
const cutText = (cards: unknown[]) =>
  JSON.stringify({ cards: [...cards, CARD] }).slice(0, -30);

const finishing = (content: string, finish_reason: string) => ({
  choices: [{ finish_reason, message: { content } }],
});

Deno.test("a reply cut off at the output cap keeps the cards it completed, marked cut", async () => {
  const second = { ...CARD, front: "귀납 논증" };
  const cut = await extractWith(finishing(cutText([CARD, second]), "length"));
  assert.equal(cut.kind, "cards");
  if (cut.kind !== "cards") return;
  assert.deepEqual(cut.cards.map((card) => card.front), [
    "연역 논증",
    "귀납 논증",
  ]);
  assert.equal(cut.cut, true);
  // Control: the same text, finished for another reason, is invalid output as before.
  const stopped = await extractWith(
    finishing(cutText([CARD, second]), "stop"),
  );
  assert.equal(stopped.kind, "invalid_output");
});

Deno.test("a whole reply that reached the cap is not cut, and a cut reply with no whole card saves none", async () => {
  const whole = await extractWith(
    finishing(JSON.stringify({ cards: [CARD] }), "length"),
  );
  assert.equal(whole.kind, "cards");
  assert.equal(whole.kind === "cards" && whole.cut, false);
  const none = await extractWith(finishing(cutText([]), "length"));
  assert.equal(none.kind, "invalid_output");
  assert.equal(none.kind === "invalid_output" && none.cut, true);
});
