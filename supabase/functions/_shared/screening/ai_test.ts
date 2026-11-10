import assert from "node:assert/strict";
import { buildPayload, parseReply, parseState, type Settings } from "./ai.ts";
import type { Claim } from "./rules.ts";

const SETTINGS: Settings = {
  id: 1,
  cheapModel: "a/b",
  strongModel: "a/c",
  confidenceFloor: 0.8,
  sampleCards: 3,
  maxInputTokens: 6000,
  maxImages: 2,
  dailyCapUsd: 5,
  assumedCallUsd: 0.01,
  prompt: "p",
};

const text = (value: string) => [{
  type: "text",
  v: 1,
  id: "b1",
  payload: { text: value },
}];
const photo = (media: string) => [{
  type: "image",
  v: 1,
  id: "i1",
  payload: { media, width: 1, height: 1, boxes: [] },
}];

function claim(count: number, extra: Record<number, unknown[]> = {}): Claim {
  return {
    name: "name",
    description: "about",
    cards: Array.from({ length: count }, (_, i) => ({
      hash: `h${i}`,
      front: extra[i] ?? text(`front ${i}`),
      back: text(`back ${i}`),
    })),
    terms: [],
  };
}

const cards = (
  payload: ReturnType<typeof buildPayload>,
) => [
  ...new Set(payload.items.flatMap((i) => i.card === null ? [] : [i.card])),
];

Deno.test("the payload holds the name and description, the flagged cards, then a bounded sample", () => {
  const payload = buildPayload(claim(20), new Set(["h17"]), "hash", SETTINGS);
  assert.deepEqual(payload.items.slice(0, 2).map((i) => i.where), [
    "name",
    "description",
  ]);
  const chosen = cards(payload);
  assert.equal(chosen[0], "h17", "the flagged card comes first");
  assert.equal(chosen.length, 1 + SETTINGS.sampleCards);
  assert.deepEqual(
    payload.items.map((i) => i.n),
    payload.items.map((_, i) => i),
  );
});

Deno.test("the sample is the same for the same hash, and differs with another", () => {
  const sampleOf = (hash: string) =>
    cards(buildPayload(claim(40), new Set(), hash, SETTINGS));
  assert.deepEqual(sampleOf("same"), sampleOf("same"));
  assert.notDeepEqual(sampleOf("same"), sampleOf("other"));
});

Deno.test("the token cap leaves out the cards that do not fit, never half a card", () => {
  const small = { ...SETTINGS, maxInputTokens: 30, sampleCards: 10 };
  const payload = buildPayload(claim(10), new Set(), "hash", small);
  const sent = payload.items.reduce((sum, i) => sum + i.text.length, 0);
  assert.equal(sent <= 2 * 30, true);
  for (const hash of cards(payload)) {
    assert.deepEqual(
      payload.items.filter((i) => i.card === hash).map((i) => i.where),
      ["front", "back"],
    );
  }
});

Deno.test("photos are numbered items, kept up to the settings' cap", () => {
  const extra = { 0: photo("m0"), 1: photo("m1"), 2: photo("m2") };
  const payload = buildPayload(
    claim(3, extra),
    new Set(["h0", "h1", "h2"]),
    "hash",
    SETTINGS,
  );
  const photos = payload.items.filter((i) => i.kind === "photo");
  assert.deepEqual(photos.map((i) => i.media), ["m0", "m1"]);
  assert.equal(payload.items.some((i) => i.text === "m0"), false);
});

Deno.test("a reply is read strictly: anything else is no verdict", () => {
  const payload = buildPayload(claim(1), new Set(), "hash", SETTINGS);
  const reply = (value: unknown) =>
    parseReply(JSON.stringify(value), payload, null);
  assert.deepEqual(
    reply({
      verdict: "severe",
      confidence: 0.9,
      flags: [{ item: 1, category: "hate" }],
    })
      ?.flags,
    [{ item: 1, category: "hate" }],
  );
  assert.equal(parseReply("nope", payload, null), null);
  assert.equal(reply({ verdict: "fine", confidence: 0.9, flags: [] }), null);
  assert.equal(reply({ verdict: "clean", confidence: 1.5, flags: [] }), null);
  assert.equal(reply({ verdict: "clean", confidence: 0.9 }), null);
  assert.equal(
    reply({
      verdict: "unsure",
      confidence: 0.9,
      flags: [{ item: 99, category: "hate" }],
    }),
    null,
  );
  assert.equal(
    reply({
      verdict: "unsure",
      confidence: 0.9,
      flags: [{ item: 1, category: "copyright" }],
    }),
    null,
  );
});

Deno.test("the state is read strictly", () => {
  const state = {
    settings: {
      id: 1,
      cheap_model: "a/b",
      strong_model: "a/c",
      confidence_floor: "0.8",
      sample_cards: 30,
      max_input_tokens: 6000,
      max_images: 4,
      daily_cap_usd: "5",
      assumed_call_usd: "0.01",
      prompt: "p",
    },
    spent_usd: "0.25",
  };
  assert.equal(parseState(state)?.spentUsd, 0.25);
  assert.equal(parseState(state)?.settings.dailyCapUsd, 5);
  assert.equal(parseState(null), null);
  assert.equal(parseState({ ...state, spent_usd: "x" }), null);
  assert.equal(
    parseState({ settings: { ...state.settings, prompt: 3 }, spent_usd: 0 }),
    null,
  );
});

Deno.test("a flagged card that does not fit the token cap makes the payload incomplete, a sampled one does not", () => {
  const big = text("가".repeat(20000));
  const small = { ...SETTINGS, maxInputTokens: 6000, sampleCards: 10 };
  const flagged = buildPayload(
    claim(3, { 1: big }),
    new Set(["h1"]),
    "hash",
    small,
  );
  assert.equal(flagged.complete, false);
  assert.equal(flagged.items.some((i) => i.card === "h1"), false);
  const sampled = buildPayload(claim(3, { 1: big }), new Set(), "hash", small);
  assert.equal(sampled.complete, true, "a sampled card may be left out");
  assert.equal(sampled.items.some((i) => i.card === "h1"), false);
  const fits = buildPayload(claim(3), new Set(["h1"]), "hash", small);
  assert.equal(fits.complete, true);
});
