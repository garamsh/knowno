// What a call counts against the eval's spend cap.
import assert from "node:assert/strict";
import {
  extractCards,
  modelId,
} from "../../supabase/functions/extract-cards/model.ts";
import { callUsd } from "./budget.ts";
import type { Pricing } from "./models.ts";

const PRICING: Pricing = {
  prompt: 0.000001,
  completion: 0.000004,
  image: 0,
  request: 0,
  // A list naming no cache price is read as the prompt's (`models.ts`).
  cacheRead: 0.000001,
  cacheWrite: 0.000001,
};
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

/** What one call to the function records for the reply's `usage`, as the eval counts it. */
async function counted(usage: unknown): Promise<number> {
  const extraction = await extractCards(
    { type: "image/png", base64: "AAAA" },
    {},
    modelId("openrouter", "vendor/model")!,
    "instructions",
    {
      provider: "openrouter",
      apiKey: "key",
      now: () => 0,
      timeoutMs: 1000,
      fetch: () =>
        Promise.resolve(Response.json({
          choices: [{
            message: { content: JSON.stringify({ cards: [CARD] }) },
          }],
          usage,
        })),
    },
  );
  return callUsd(PRICING, extraction.attempts[0].usage);
}

Deno.test("a BYOK reply counts its upstream cost against the cap", async () => {
  assert.equal(
    await counted({
      prompt_tokens: 1000,
      completion_tokens: 50,
      cost: 0,
      is_byok: true,
      cost_details: { upstream_inference_cost: 0.0023 },
    }),
    0.0023,
  );
  assert.equal(
    await counted({ prompt_tokens: 1000, completion_tokens: 50, cost: 0.001 }),
    0.001,
    "control: a reply billed by OpenRouter counts its cost alone",
  );
});

Deno.test("a reply reporting no cost is priced from its tokens, and one reporting no usage costs nothing", () => {
  assert.ok(
    Math.abs(
      callUsd(PRICING, {
        promptTokens: 1000,
        completionTokens: 50,
        costUsd: null,
      }) - 0.0012,
    ) < 1e-12,
  );
  assert.equal(callUsd(PRICING, null), 0);
});
