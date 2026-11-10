import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { readConfig } from "./config.ts";
import { costOf, createHandler } from "./handler.ts";
import { buildPayload, cut, locate, parseReply } from "./payload.ts";
import { readAnswer } from "./provider.ts";

const URL_BASE = "https://example.supabase.co";
const SERVICE = "service-key";
const CONFIG = readConfig((name) =>
  ({
    SUPABASE_URL: URL_BASE,
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  })[name]
);

const configuration = {
  id: 7,
  cheap_provider: "anthropic",
  cheap_model: "cheap-model",
  strong_provider: "openai",
  strong_model: "strong-model",
  prompt: "Judge the note.",
  cheap_in_usd: 1,
  cheap_out_usd: 5,
  strong_in_usd: 3,
  strong_out_usd: 15,
  escalate_below: 0.7,
  payload_tokens: 3000,
  sample_cards: 5,
};

const textBlock = (text: string) => [{
  type: "text",
  v: 1,
  id: "b1",
  payload: { text },
}];
const card = (n: number, text = `card text ${n}`) => ({
  hash: `h${n}`,
  front: textBlock(text),
  back: [],
});

function claim(over: Record<string, unknown> = {}) {
  return {
    hash: "note-hash",
    name: "Spring sale",
    description: null,
    cards: [{ ...card(1, "Buy two get one free at shop.example") }],
    reasons: ["spam"],
    reporters: 2,
    findings: [],
    configuration,
    ...over,
  };
}

/** An answer of the cheap (Anthropic) or strong (OpenAI) provider. */
const cheapReply = (verdict: unknown, tokens = [3000, 150]) =>
  Response.json({
    content: [{ type: "text", text: JSON.stringify(verdict) }],
    usage: { input_tokens: tokens[0], output_tokens: tokens[1] },
  });
const strongReply = (verdict: unknown, tokens = [3000, 150]) =>
  Response.json({
    choices: [{ message: { content: JSON.stringify(verdict) } }],
    usage: { prompt_tokens: tokens[0], completion_tokens: tokens[1] },
  });

type World = {
  due?: unknown;
  claim?: unknown;
  cheap?: () => Response;
  strong?: () => Response;
  keys?: Record<string, string | null>;
  admin?: "recent" | "stale" | "not_admin";
  user?: string | null;
};

function setup(world: World) {
  const calls: { name: string; body: Record<string, unknown> }[] = [];
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const logs: Record<string, unknown>[] = [];
  const fetcher = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.startsWith(`${URL_BASE}/rest/v1/rpc/`)) {
      const name = url.split("/").pop() ?? "";
      calls.push({ name, body });
      switch (name) {
        case "triage_due":
          return Promise.resolve(Response.json(world.due ?? []));
        case "triage_claim":
          return Promise.resolve(Response.json(world.claim ?? null));
        case "provider_key":
          return Promise.resolve(Response.json(
            (world.keys ?? { anthropic: "ant-key", openai: "oai-key" })[
              body.provider
            ] ?? null,
          ));
        case "record_triage":
          return Promise.resolve(Response.json("recorded"));
        case "save_triage_configuration":
          return Promise.resolve(Response.json(41));
        case "admin_ai_session": {
          const admin = world.admin ?? "recent";
          return Promise.resolve(
            admin === "not_admin"
              ? new Response(null, { status: 403 })
              : Response.json(admin === "recent"),
          );
        }
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    if (url === `${URL_BASE}/auth/v1/user`) {
      return Promise.resolve(
        world.user === null
          ? new Response(null, { status: 401 })
          : Response.json({
            id: world.user ?? "11111111-1111-4111-8111-111111111111",
          }),
      );
    }
    sent.push({ url, body });
    const answer = url.includes("anthropic") ? world.cheap : world.strong;
    return Promise.resolve(
      answer === undefined ? new Response(null, { status: 500 }) : answer(),
    );
  };
  const handler = createHandler({
    config: CONFIG,
    fetch: fetcher as typeof fetch,
    now: () => 0,
    log: (entry) => logs.push(entry),
  });
  return { handler, calls, sent, logs };
}

const work = (severe?: boolean, bearer = SERVICE) =>
  new Request(`${URL_BASE}/functions/v1/triage-reports/work`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(severe === undefined ? {} : { severe }),
  });

const recorded = (calls: { name: string; body: Record<string, unknown> }[]) =>
  calls.filter((c) => c.name === "record_triage").map((c) => c.body);

const DUE = [{ deck_id: "d1" }];

Deno.test("work refuses a bearer that is not the service key and reads nothing", async () => {
  const { handler, calls } = setup({ due: DUE });
  const response = await handler(work(undefined, "other"));
  assertEquals(response.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test("work judges a note once with the cheap model when it is sure", async () => {
  const { handler, calls, sent } = setup({
    due: DUE,
    claim: claim(),
    cheap: () =>
      cheapReply({ category: "ad", confidence: 0.95, passage: "shop.example" }),
  });
  const response = await handler(work());
  assertEquals(response.status, 200);
  assertEquals(sent.length, 1);
  assertStringIncludes(sent[0]!.url, "anthropic");
  const [verdict] = recorded(calls);
  assertEquals(verdict?.category, "ad");
  assertEquals(verdict?.tier, "cheap");
  assertEquals(verdict?.escalated, false);
  assertEquals(verdict?.content_hash, "note-hash");
  assertEquals(verdict?.passage, "shop.example");
  assertEquals(verdict?.field, "front:text");
  assertEquals(verdict?.card_hash, "h1");
  assertEquals(verdict?.model, "cheap-model");
  assertEquals(verdict?.configuration_id, 7);
  // 3000 tokens in at $1 per million and 150 out at $5: $0.00375.
  assertEquals(verdict?.cost_usd, 0.00375);
});

Deno.test("work escalates to the strong model below the threshold, and not at it", async () => {
  const unsure = setup({
    due: DUE,
    claim: claim(),
    cheap: () =>
      cheapReply({ category: "spam", confidence: 0.69, passage: null }),
    strong: () =>
      strongReply({ category: "spam", confidence: 0.95, passage: null }),
  });
  await unsure.handler(work());
  assertEquals(unsure.sent.length, 2);
  const [verdict] = recorded(unsure.calls);
  assertEquals(verdict?.tier, "strong");
  assertEquals(verdict?.escalated, true);
  assertEquals(verdict?.model, "strong-model");
  // The cheap call $0.00375 and the strong one $0.01125.
  assertEquals(verdict?.cost_usd, 0.015);
  assertEquals(verdict?.tokens_in, 6000);

  const sure = setup({
    due: DUE,
    claim: claim(),
    cheap: () =>
      cheapReply({ category: "spam", confidence: 0.7, passage: null }),
    strong: () =>
      strongReply({ category: "ok", confidence: 0.99, passage: null }),
  });
  await sure.handler(work());
  assertEquals(sure.sent.length, 1);
  assertEquals(recorded(sure.calls)[0]?.escalated, false);
});

Deno.test("work escalates a verdict of other, which a person would otherwise get unchecked", async () => {
  const { handler, calls, sent } = setup({
    due: DUE,
    claim: claim(),
    cheap: () =>
      cheapReply({ category: "other", confidence: 0.95, passage: null }),
    strong: () =>
      strongReply({ category: "copyright", confidence: 0.9, passage: null }),
  });
  await handler(work());
  assertEquals(sent.length, 2);
  assertEquals(recorded(calls)[0]?.category, "copyright");
});

Deno.test("work makes no call for a note the database no longer holds due", async () => {
  const { handler, calls, sent } = setup({ due: DUE, claim: null });
  await handler(work());
  assertEquals(sent.length, 0);
  assertEquals(recorded(calls).length, 0);
});

Deno.test("work records nothing when no model answers, so the note stays due", async () => {
  const { handler, calls, sent } = setup({ due: DUE, claim: claim() });
  const response = await handler(work());
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { outcomes: { failed: 1 } });
  assertEquals(sent.length, 1);
  assertEquals(recorded(calls).length, 0);
});

Deno.test("work records unjudged, with the cost, when neither answer parses", async () => {
  const { handler, calls, sent } = setup({
    due: DUE,
    claim: claim(),
    cheap: () =>
      Response.json({
        content: [{ type: "text", text: "not json" }],
        usage: { input_tokens: 100, output_tokens: 10 },
      }),
    strong: () =>
      Response.json({
        choices: [{ message: { content: "{}" } }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      }),
  });
  await handler(work());
  assertEquals(sent.length, 2);
  const [verdict] = recorded(calls);
  assertEquals(verdict?.category, "unjudged");
  assertEquals(verdict?.confidence, 0);
  assertEquals(verdict?.tokens_in, 200);
  assertEquals(verdict?.passage, null);
});

Deno.test("work keeps the cheap verdict when the strong call fails", async () => {
  const { handler, calls } = setup({
    due: DUE,
    claim: claim(),
    cheap: () =>
      cheapReply({ category: "spam", confidence: 0.5, passage: null }),
  });
  await handler(work());
  const [verdict] = recorded(calls);
  assertEquals(verdict?.category, "spam");
  assertEquals(verdict?.tier, "cheap");
  assertEquals(verdict?.escalated, true);
});

Deno.test("work calls no provider while a tier has no key", async () => {
  const { handler, calls, sent } = setup({
    due: DUE,
    claim: claim(),
    keys: { anthropic: null, openai: "k" },
  });
  const response = await handler(work());
  assertEquals(await response.json(), { outcomes: { no_key: 1 } });
  assertEquals(sent.length, 0);
  assertEquals(recorded(calls).length, 0);
});

Deno.test("work asks only for severe notes when told so", async () => {
  const { handler, calls } = setup({ due: [] });
  await handler(work(true));
  assertEquals(calls.find((c) => c.name === "triage_due")?.body, {
    max_notes: 10,
    severe_only: true,
  });
  const batch = setup({ due: [] });
  await batch.handler(work());
  assertEquals(
    batch.calls.find((c) => c.name === "triage_due")?.body.severe_only,
    false,
  );
});

Deno.test("work sends the note as data, bounded, and no key in a log", async () => {
  const cards = Array.from({ length: 40 }, (_, n) => card(n, "x".repeat(5000)));
  const { handler, sent, logs } = setup({
    due: DUE,
    claim: claim({ cards }),
    cheap: () => cheapReply({ category: "ok", confidence: 0.9, passage: null }),
  });
  await handler(work());
  const user = JSON.stringify(sent[0]?.body.messages);
  assertEquals(
    new TextEncoder().encode(String(
      (sent[0]?.body.messages as { content: string }[])[0]?.content,
    )).length <= 3000 * 4,
    true,
  );
  assertStringIncludes(user, "<note>");
  assertEquals(JSON.stringify(logs).includes("ant-key"), false);
  assertEquals(JSON.stringify(logs).includes("xxxx"), false);
});

Deno.test("the payload holds the flagged cards and a fixed sample of the rest within the budget", async () => {
  const cards = Array.from({ length: 12 }, (_, n) => card(n));
  const base = {
    hash: "n",
    name: "Name",
    description: null,
    cards,
    reasons: ["spam"],
    reporters: 2,
    findings: [{
      card: "h3",
      where: "front" as const,
      block: 0,
      field: "text",
      category: "link" as const,
      start: 0,
      end: 1,
    }],
  };
  const first = await buildPayload(base, 3000, 2);
  const again = await buildPayload(base, 3000, 2);
  assertEquals(first.text, again.text);
  assertEquals(first.places.filter((p) => p.card !== null).length, 3);
  assertEquals(first.places.some((p) => p.card === "h3"), true);
  const none = await buildPayload(base, 3000, 0);
  assertEquals(none.places.filter((p) => p.card !== null).length, 1);
  const small = await buildPayload(base, 500, 12);
  assertEquals(new TextEncoder().encode(small.text).length <= 500 * 4, true);
});

Deno.test("cut keeps whole characters within the byte limit", () => {
  assertEquals(cut("가나다", 7), "가나");
  assertEquals(cut("abc", 0), "");
});

Deno.test("a reply is read strictly", () => {
  assertEquals(
    parseReply('{"category":"spam","confidence":0.8,"passage":"x"}')?.category,
    "spam",
  );
  assertEquals(
    parseReply('```json\n{"category":"ok","confidence":1,"passage":null}\n```')
      ?.category,
    "ok",
  );
  assertEquals(
    parseReply('{"category":"unjudged","confidence":0.8,"passage":null}'),
    null,
  );
  assertEquals(
    parseReply('{"category":"spam","confidence":1.5,"passage":null}'),
    null,
  );
  assertEquals(parseReply('{"category":"spam","confidence":"high"}'), null);
  assertEquals(parseReply("[]"), null);
  assertEquals(parseReply("spam"), null);
});

Deno.test("a passage is placed only where the payload holds it", () => {
  const places = [{
    text: "see shop.example",
    card: "h1",
    field: "front:text",
  }];
  assertEquals(locate("shop.example", places)?.card, "h1");
  assertEquals(locate("invented", places), null);
  assertEquals(locate(null, places), null);
});

Deno.test("a call costs what the provider reports, else its tokens at the tier's prices", () => {
  const tier = { provider: "openai" as const, model: "m", inUsd: 1, outUsd: 5 };
  assertEquals(
    costOf(tier, { tokensIn: 1000, tokensOut: 100, costUsd: null }),
    0.0015,
  );
  assertEquals(
    costOf(tier, { tokensIn: 1000, tokensOut: 100, costUsd: 0.5 }),
    0.5,
  );
  const answer = readAnswer("openrouter", {
    choices: [{ message: { content: "{}" } }],
    usage: { prompt_tokens: 1, completion_tokens: 2, cost: 0.002 },
  });
  assertEquals(answer?.kind === "answer" ? answer.costUsd : null, 0.002);
});

const settings = (body: unknown, token = "admin-token") =>
  new Request(
    `${URL_BASE}/functions/v1/triage-reports/settings/configuration`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    },
  );

const tiers = {
  cheap: { provider: "anthropic", model: "cheap-model", in_usd: 1, out_usd: 5 },
  strong: { provider: "openai", model: "strong-model", in_usd: 3, out_usd: 15 },
  prompt: "Judge the note.",
};
const good = {
  cheap: () => cheapReply({ category: "ad", confidence: 0.9, passage: "Buy" }),
  strong: () =>
    strongReply({ category: "ad", confidence: 0.9, passage: "Buy" }),
};

Deno.test("settings saves a configuration after each tier answered the contract", async () => {
  const { handler, calls, sent } = setup({ ...good });
  const response = await handler(settings(tiers));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { saved: true, configuration_id: 41 });
  assertEquals(sent.length, 2);
  const saved = calls.find((c) => c.name === "save_triage_configuration")?.body;
  assertEquals(saved?.admin_id, "11111111-1111-4111-8111-111111111111");
  assertEquals(saved?.cheap_model, "cheap-model");
  assertEquals(saved?.escalate_below, 0.7);
});

Deno.test("settings saves nothing for each refusal", async () => {
  const cases: [string, World, unknown, number][] = [
    ["unauthenticated", { ...good, user: null }, tiers, 401],
    ["forbidden", { ...good, admin: "not_admin" }, tiers, 403],
    ["reauth", { ...good, admin: "stale" }, tiers, 403],
    ["bad_request", { ...good }, { ...tiers, prompt: "" }, 400],
    ["bad_request", { ...good }, {
      ...tiers,
      cheap: { ...tiers.cheap, provider: "acme" },
    }, 400],
    ["no_key", { ...good, keys: { anthropic: "k", openai: null } }, tiers, 409],
    [
      "bad_output",
      { cheap: () => cheapReply({ nope: 1 }), strong: good.strong },
      tiers,
      422,
    ],
    [
      "key_refused",
      { cheap: good.cheap, strong: () => new Response(null, { status: 401 }) },
      tiers,
      422,
    ],
  ];
  for (const [code, world, body, status] of cases) {
    const { handler, calls } = setup(world);
    const response = await handler(settings(body));
    const label = `${code} ${status}`;
    assertEquals(response.status, status, label);
    assertEquals((await response.json()).error, code, label);
    assertEquals(
      calls.some((c) => c.name === "save_triage_configuration"),
      false,
      label,
    );
  }
});

Deno.test("an unknown route and a wrong method are refused", async () => {
  const { handler } = setup({});
  assertEquals(
    (await handler(
      new Request(`${URL_BASE}/functions/v1/triage-reports/elsewhere`, {
        method: "POST",
      }),
    )).status,
    404,
  );
  assertEquals(
    (await handler(new Request(`${URL_BASE}/functions/v1/triage-reports/work`)))
      .status,
    405,
  );
});
