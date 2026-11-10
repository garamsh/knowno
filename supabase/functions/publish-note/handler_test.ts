// The handler end to end, with the database and Supabase Auth replaced by a recording fake fetch.
import assert from "node:assert/strict";
import { RULES_VERSION } from "../_shared/screening/rules.ts";
import { readConfig } from "./config.ts";
import { createHandler } from "./handler.ts";

const URL_ = "https://project.supabase.test";
const SERVICE = "service-role-key";
const ANON = "anon-key";
const USER = "11111111-1111-4111-8111-111111111111";
const DECK = "22222222-2222-4222-8222-222222222222";

const ENV: Record<string, string> = {
  SUPABASE_URL: URL_,
  SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
};

type Fake = {
  claim: Record<string, unknown> | null;
  /** A claim by deck, over [claim]. */
  claims: Record<string, Record<string, unknown>>;
  due: string[];
  requestStatus: number;
  recorded: Record<string, unknown>[];
  applied: Record<string, unknown>[];
  calls: { name: string; bearer: string | null; key: string | null }[];
  /** The settings and spend `screening_ai_state` answers; null answers no settings. */
  state: Record<string, unknown> | null;
  /** OpenRouter's key in Vault. */
  openrouterKey: string | null;
  /** What the fake provider answers, one per call in turn; the last is repeated. */
  replies: ProviderReply[];
  /** Each call the fake provider got: the model and the user content it was sent. */
  provider: { model: string; content: unknown[]; auth: string | null }[];
  spends: Record<string, unknown>[];
  /** What the bucket answers for a media id: its type and size, absent for a miss. */
  photos: Record<string, { type: string; bytes: number }>;
};

type ProviderReply =
  | { verdict: string; confidence: number; flags?: unknown[]; cost?: number }
  | { status: number }
  | "down"
  | "timeout"
  | "garbage";

const SETTINGS = {
  id: 7,
  cheap_model: "vendor/cheap",
  strong_model: "vendor/strong",
  confidence_floor: 0.8,
  sample_cards: 30,
  max_input_tokens: 6000,
  max_images: 4,
  daily_cap_usd: 5,
  assumed_call_usd: 0.01,
  prompt: "screen it",
};
const stateOf = (spent: number) => ({ settings: SETTINGS, spent_usd: spent });

const text = (value: string) => [{
  type: "text",
  v: 1,
  id: "b1",
  payload: { text: value },
}];

function claimOf(
  front: string,
  verdicts: unknown[] = [],
  terms: string[] = [],
) {
  return {
    hash: "hash-1",
    publication: "checking",
    owner: USER,
    name: "단어",
    description: null,
    cards: [{ hash: "c1", front: text(front), back: text("답") }],
    terms,
    terms_version: "0.0",
    verdicts,
  };
}

function setup(over: Partial<Fake> = {}) {
  const fake: Fake = {
    claim: claimOf("apple"),
    claims: {},
    due: [],
    requestStatus: 200,
    recorded: [],
    applied: [],
    calls: [],
    state: stateOf(0),
    openrouterKey: "or-key",
    replies: [{ verdict: "clean", confidence: 0.95, cost: 0.001 }],
    provider: [],
    spends: [],
    photos: {},
    ...over,
  };
  const logs: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    if (url.host === "openrouter.ai") {
      const sent = JSON.parse(String(init?.body));
      fake.provider.push({
        model: sent.model,
        content: sent.messages[1].content,
        auth: new Headers(init?.headers).get("Authorization"),
      });
      const reply = fake.replies[
        Math.min(
          fake.provider.length - 1,
          fake.replies.length - 1,
        )
      ];
      if (reply === "timeout") {
        return Promise.reject(new DOMException("aborted", "AbortError"));
      }
      if (reply === "down") {
        return Promise.resolve(new Response(null, { status: 503 }));
      }
      if (reply !== "garbage" && "status" in reply) {
        return Promise.resolve(new Response(null, { status: reply.status }));
      }
      return Promise.resolve(Response.json({
        choices: [{
          message: {
            content: reply === "garbage" ? "not json" : JSON.stringify({
              verdict: reply.verdict,
              confidence: reply.confidence,
              flags: reply.flags ?? [],
            }),
          },
          finish_reason: "stop",
        }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 10,
          ...(reply === "garbage" || reply.cost === undefined
            ? {}
            : { cost: reply.cost }),
        },
      }));
    }
    if (url.pathname.startsWith("/storage/v1/object/media/")) {
      const photo = fake.photos[url.pathname.split("/").pop() ?? ""];
      return Promise.resolve(
        photo === undefined
          ? new Response(null, { status: 404 })
          : new Response(new Uint8Array(photo.bytes), {
            headers: { "Content-Type": photo.type },
          }),
      );
    }
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        headers.get("Authorization") === "Bearer user-token"
          ? Response.json({ id: USER })
          : new Response(null, { status: 401 }),
      );
    }
    const name = url.pathname.replace("/rest/v1/rpc/", "");
    fake.calls.push({
      name,
      bearer: headers.get("Authorization"),
      key: headers.get("apikey"),
    });
    switch (name) {
      case "request_deck_publication":
        return Promise.resolve(
          fake.requestStatus === 200
            ? Response.json("checking")
            : new Response(null, { status: fake.requestStatus }),
        );
      case "screening_due":
        return Promise.resolve(
          Response.json(fake.due.map((deck_id) => ({ deck_id }))),
        );
      case "screening_claim":
        return Promise.resolve(
          Response.json(fake.claims[String(body.deck_id)] ?? fake.claim),
        );
      case "record_screening":
        fake.recorded.push(body);
        return Promise.resolve(Response.json("recorded"));
      case "apply_screening":
        fake.applied.push(body);
        return Promise.resolve(Response.json("public"));
      case "screening_ai_state":
        return Promise.resolve(Response.json(fake.state));
      case "record_screening_call":
        fake.spends.push(body);
        return Promise.resolve(new Response(null, { status: 204 }));
      case "my_deck_screening":
        return Promise.resolve(
          Response.json({ state: "public", refusal: null, findings: [] }),
        );
    }
    throw new Error(`unexpected ${name}`);
  };
  const handler = createHandler({
    config: readConfig((n) => ENV[n]),
    fetch: fetcher,
    keys: { get: () => Promise.resolve(fake.openrouterKey), forget: () => {} },
    log: (e) => logs.push(e),
  });
  return { fake, logs, handler };
}

const post = (
  path: string,
  token: string | null,
  body: unknown = { deck_id: DECK },
) =>
  new Request(`${URL_}/publish-note${path}`, {
    method: "POST",
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

Deno.test("an owner's request is recorded as the owner, screened at once and answered with its state", async () => {
  const { fake, handler } = setup();
  const response = await handler(post("", "user-token"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    state: "public",
    refusal: null,
    findings: [],
  });
  const ask = fake.calls.find((c) => c.name === "request_deck_publication");
  assert.equal(ask?.bearer, "Bearer user-token");
  assert.equal(ask?.key, ANON);
  assert.deepEqual(fake.recorded.map((r) => r.layer), ["rules", "ai"]);
  assert.equal(fake.recorded[0]?.outcome, "clean");
  assert.equal(fake.recorded[0]?.version, `${RULES_VERSION}+0.0`);
  assert.deepEqual(fake.applied, [{ deck_id: DECK, content_hash: "hash-1" }]);
});

Deno.test("a verdict of the rules records its findings and no text", async () => {
  const { fake, handler } = setup({ claim: claimOf("010-1234-5678") });
  await handler(post("", "user-token"));
  assert.equal(fake.recorded[0]?.outcome, "refused");
  assert.equal(JSON.stringify(fake.recorded[0]).includes("1234"), false);
  assert.equal(
    fake.recorded.length,
    1,
    "a refusal by the rules is not asked of the AI",
  );
  assert.equal(fake.provider.length, 0);
});

Deno.test("a verdict of this version is not made again", async () => {
  const { fake, handler } = setup({
    claim: claimOf("apple", [{
      layer: "rules",
      version: `${RULES_VERSION}+0.0`,
      outcome: "clean",
    }]),
  });
  await handler(post("", "user-token"));
  assert.deepEqual(fake.recorded.map((r) => r.layer), ["ai"]);
  assert.equal(fake.applied.length, 1);
});

Deno.test("a verdict of an older rules version or of other terms is made again", async () => {
  for (const version of ["0+0.0", `${RULES_VERSION}+1.0`]) {
    const { fake, handler } = setup({
      claim: claimOf("apple", [{ layer: "rules", version, outcome: "clean" }]),
    });
    await handler(post("", "user-token"));
    assert.equal(fake.recorded[0]?.layer, "rules", version);
    assert.equal(fake.recorded[0]?.version, `${RULES_VERSION}+0.0`);
  }
});

Deno.test("a request without a signed-in user is refused before any database call", async () => {
  const { fake, handler } = setup();
  assert.equal((await handler(post("", null))).status, 401);
  assert.equal((await handler(post("", "anon-key"))).status, 401);
  assert.deepEqual(fake.calls, []);
});

Deno.test("a deck that is not the caller's is not found, and a bad body is refused", async () => {
  const { handler, fake } = setup({ requestStatus: 404 });
  assert.equal((await handler(post("", "user-token"))).status, 404);
  assert.equal(fake.recorded.length, 0);
  assert.equal(
    (await handler(post("", "user-token", { deck_id: "nope" }))).status,
    400,
  );
});

Deno.test("a suspended owner is forbidden", async () => {
  const { handler } = setup({ requestStatus: 403 });
  assert.equal((await handler(post("", "user-token"))).status, 403);
});

Deno.test("/work screens each due note, and takes only the service-role key", async () => {
  const { fake, handler, logs } = setup({ due: [DECK] });
  assert.equal((await handler(post("/work", "user-token"))).status, 401);
  assert.equal((await handler(post("/work", null))).status, 401);
  assert.equal(fake.applied.length, 0);
  const response = await handler(post("/work", SERVICE));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    screened: 1,
    outcomes: { public: 1 },
  });
  assert.equal(fake.applied.length, 1);
  assert.equal(JSON.stringify(logs).includes("apple"), false);
});

Deno.test("a note that fails in any way does not stop the others of the batch", async () => {
  const BAD = "33333333-3333-4333-8333-333333333333";
  const LAST = "44444444-4444-4444-8444-444444444444";
  const { fake, handler, logs } = setup({
    due: [DECK, BAD, LAST],
    // A claim of a shape the rules cannot read throws a TypeError, not a SupabaseError.
    claims: { [BAD]: { ...claimOf("secret text"), cards: null } },
  });
  const response = await handler(post("/work", SERVICE));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    screened: 3,
    outcomes: { public: 2, failed: 1 },
  });
  assert.deepEqual(fake.applied.map((a) => a.deck_id), [DECK, LAST]);
  assert.equal(
    logs.some((l) => l.deck === BAD && l.outcome === "failed"),
    true,
  );
  assert.equal(JSON.stringify(logs).includes("secret"), false);
});

Deno.test("a note no longer checking is skipped", async () => {
  const { fake, handler } = setup({ due: [DECK], claim: null });
  const response = await handler(post("/work", SERVICE));
  assert.deepEqual(await response.json(), {
    screened: 1,
    outcomes: { skipped: 1 },
  });
  assert.equal(fake.applied.length, 0);
});

Deno.test("only POST is served, and an unconfigured function answers 503", async () => {
  const { handler } = setup();
  assert.equal(
    (await handler(new Request(`${URL_}/publish-note`))).status,
    405,
  );
  const bare = createHandler({
    config: readConfig(() => undefined),
    fetch,
    keys: { get: () => Promise.resolve(null), forget: () => {} },
    log: () => {},
  });
  assert.equal((await bare(post("", "user-token"))).status, 503);
});

const aiOf = (fake: Fake) => fake.recorded.find((r) => r.layer === "ai");
const models = (fake: Fake) => fake.provider.map((p) => p.model);

Deno.test("a clean note is asked of the cheap model alone and its clean verdict is recorded with the call's cost", async () => {
  const { fake, handler } = setup();
  await handler(post("", "user-token"));
  assert.deepEqual(models(fake), ["vendor/cheap"]);
  assert.equal(fake.provider[0]?.auth, "Bearer or-key");
  assert.equal(aiOf(fake)?.outcome, "clean");
  assert.equal(aiOf(fake)?.version, "ai:7");
  assert.deepEqual(aiOf(fake)?.findings, []);
  assert.equal(fake.spends.length, 1);
  assert.equal(fake.spends[0]?.tier, "cheap");
  assert.equal(fake.spends[0]?.settings_id, 7);
  assert.equal(fake.spends[0]?.cost_usd, 0.001);
  assert.equal(fake.spends[0]?.prompt_tokens, 100);
});

Deno.test("a verdict the strong model is unsure of is recorded unsure, which holds the note", async () => {
  const { fake, handler } = setup({
    replies: [{ verdict: "unsure", confidence: 0.9 }, {
      verdict: "unsure",
      confidence: 0.9,
      flags: [{ item: 1, category: "spam" }],
    }],
  });
  await handler(post("", "user-token"));
  assert.equal(aiOf(fake)?.outcome, "unsure");
  assert.equal(aiOf(fake)?.version, "ai:7");
  assert.deepEqual(aiOf(fake)?.findings, [{
    card: "c1",
    where: "front",
    block: null,
    field: null,
    category: "spam",
    start: null,
    end: null,
  }]);
});

Deno.test("a clear severe verdict is recorded severe, with where it was found and no text", async () => {
  const { fake, handler, logs } = setup({
    claim: claimOf("secret front"),
    replies: [{
      verdict: "severe",
      confidence: 0.97,
      flags: [{ item: 2, category: "sexual" }],
    }],
  });
  await handler(post("", "user-token"));
  assert.deepEqual(models(fake), ["vendor/cheap"]);
  assert.equal(aiOf(fake)?.outcome, "severe");
  assert.equal(
    (aiOf(fake)?.findings as { category: string }[])[0]?.category,
    "sexual",
  );
  assert.equal(JSON.stringify(aiOf(fake)).includes("secret"), false);
  assert.equal(JSON.stringify(fake.spends).includes("secret"), false);
  assert.equal(JSON.stringify(logs).includes("secret"), false);
  assert.equal(
    logs.some((l) => l.route === "ai" && l.outcome === "severe"),
    true,
  );
});

Deno.test("the strong model is asked only of what the cheap one is unsure of", async () => {
  for (
    const first of [
      { verdict: "unsure", confidence: 0.99 },
      { verdict: "clean", confidence: 0.5 },
      { verdict: "severe", confidence: 0.6 },
    ]
  ) {
    const { fake, handler } = setup({
      replies: [first, { verdict: "clean", confidence: 0.95 }],
    });
    await handler(post("", "user-token"));
    assert.deepEqual(models(fake), ["vendor/cheap", "vendor/strong"]);
    assert.equal(
      aiOf(fake)?.outcome,
      "clean",
      "the strong model's verdict stands",
    );
    assert.deepEqual(fake.spends.map((s) => s.tier), ["cheap", "strong"]);
  }
  const confident = setup({
    replies: [{ verdict: "clean", confidence: 0.8 }],
  });
  await confident.handler(post("", "user-token"));
  assert.deepEqual(models(confident.fake), ["vendor/cheap"]);
});

Deno.test("a note with a verdict of the AI layer on its hash is not asked again", async () => {
  const { fake, handler } = setup({
    claim: claimOf("apple", [
      { layer: "rules", version: `${RULES_VERSION}+0.0`, outcome: "clean" },
      { layer: "ai", version: "ai:3", outcome: "clean" },
    ]),
  });
  await handler(post("", "user-token"));
  assert.deepEqual(fake.provider, []);
  assert.deepEqual(fake.recorded, []);
  assert.deepEqual(fake.spends, []);
  assert.equal(fake.calls.some((c) => c.name === "screening_ai_state"), false);
  assert.equal(fake.applied.length, 1);
});

Deno.test("a verdict that could not decide is asked again", async () => {
  const { fake, handler } = setup({
    claim: claimOf("apple", [
      { layer: "ai", version: "unavailable", outcome: "unsure" },
    ]),
  });
  await handler(post("", "user-token"));
  assert.deepEqual(models(fake), ["vendor/cheap"]);
  assert.equal(aiOf(fake)?.version, "ai:7");
});

Deno.test("past the daily cap no model is called and the note is held for a person", async () => {
  const { fake, handler, logs } = setup({ state: stateOf(5) });
  await handler(post("", "user-token"));
  assert.deepEqual(fake.provider, []);
  assert.deepEqual(fake.spends, []);
  assert.equal(aiOf(fake)?.outcome, "unsure");
  assert.equal(aiOf(fake)?.version, "unavailable");
  assert.equal(fake.applied.length, 1);
  assert.equal(
    logs.some((l) => l.route === "ai" && l.unavailable === "capped"),
    true,
  );
});

Deno.test("the cap is checked before the strong call too, with an unreported cost charged as assumed", async () => {
  const { fake, handler } = setup({
    state: stateOf(4.995),
    replies: [{ verdict: "unsure", confidence: 0.9 }],
  });
  await handler(post("", "user-token"));
  assert.deepEqual(models(fake), ["vendor/cheap"]);
  assert.equal(fake.spends[0]?.cost_usd, 0.01);
  assert.equal(aiOf(fake)?.version, "unavailable");
});

Deno.test("a banned term alone goes to the AI layer instead of refusing", async () => {
  const claim = claimOf("도박사이트", [], ["도박사이트"]);
  const { fake, handler } = setup({ claim });
  await handler(post("", "user-token"));
  assert.equal(fake.recorded[0]?.layer, "rules");
  assert.equal(fake.recorded[0]?.outcome, "unsure");
  assert.deepEqual(models(fake), ["vendor/cheap"]);
  assert.equal(aiOf(fake)?.outcome, "clean");
  const flagged = (fake.provider[0]?.content[0] as { text: string }).text;
  assert.equal(
    flagged.includes("도박사이트"),
    true,
    "the flagged card is sent",
  );
});

Deno.test("a banned term alone is held when the AI layer is unavailable", async () => {
  const claim = claimOf("도박사이트", [], ["도박사이트"]);
  const cases: Partial<Fake>[] = [
    { state: null },
    { openrouterKey: null },
    { state: stateOf(5) },
    { replies: ["down"] },
    { replies: ["garbage"] },
  ];
  for (const over of cases) {
    const { fake, handler } = setup({ claim, ...over });
    await handler(post("", "user-token"));
    assert.equal(fake.recorded[0]?.outcome, "unsure", JSON.stringify(over));
    assert.equal(aiOf(fake)?.outcome, "unsure", JSON.stringify(over));
    assert.equal(aiOf(fake)?.version, "unavailable", JSON.stringify(over));
  }
});

Deno.test("a banned term beside another finding refuses at once, without the AI", async () => {
  const claim = claimOf("도박사이트 010-1234-5678", [], ["도박사이트"]);
  const { fake, handler } = setup({ claim });
  await handler(post("", "user-token"));
  assert.equal(fake.recorded[0]?.outcome, "refused");
  assert.deepEqual(fake.provider, []);
  assert.equal(aiOf(fake), undefined);
});

Deno.test("a call the provider refused is not charged to the cap, and the log says which status", async () => {
  for (const status of [401, 429, 503]) {
    const { fake, handler, logs } = setup({
      claim: claimOf("도박사이트", [], ["도박사이트"]),
      replies: [{ status }],
    });
    await handler(post("", "user-token"));
    assert.deepEqual(fake.spends, [], `${status} is no spend`);
    assert.equal(aiOf(fake)?.version, "unavailable");
    assert.equal(
      logs.some((l) =>
        l.route === "ai" && l.unavailable === "failed" &&
        l.failure === `http_${status}`
      ),
      true,
      `${status} reaches the log`,
    );
  }
});

Deno.test("a call that timed out or answered no verdict may have been billed: it is charged and the log says why", async () => {
  const cases: [ProviderReply, string][] = [
    ["timeout", "timeout"],
    ["garbage", "unparseable"],
  ];
  for (const [reply, failure] of cases) {
    const { fake, handler, logs } = setup({ replies: [reply] });
    await handler(post("", "user-token"));
    assert.equal(fake.spends.length, 1, failure);
    assert.equal(fake.spends[0]?.cost_usd, 0.01, failure);
    assert.equal(
      logs.some((l) => l.route === "ai" && l.failure === failure),
      true,
      failure,
    );
  }
});

Deno.test("a flagged card too large to send holds the note instead of judging the rest", async () => {
  const claim = claimOf("도박사이트" + "가".repeat(20000), [], ["도박사이트"]);
  const { fake, handler, logs } = setup({ claim });
  await handler(post("", "user-token"));
  assert.deepEqual(
    fake.provider,
    [],
    "no model reads a note it cannot read whole",
  );
  assert.deepEqual(fake.spends, []);
  assert.equal(aiOf(fake)?.outcome, "unsure");
  assert.equal(aiOf(fake)?.version, "unavailable");
  assert.equal(
    logs.some((l) => l.route === "ai" && l.unavailable === "oversized"),
    true,
  );
  const control = setup({ claim: claimOf("도박사이트", [], ["도박사이트"]) });
  await control.handler(post("", "user-token"));
  assert.equal(
    aiOf(control.fake)?.outcome,
    "clean",
    "a card that fits is judged",
  );
});

const MEDIA = "55555555-5555-4555-8555-555555555555";
const withPhoto = () => ({
  ...claimOf("apple"),
  cards: [{
    hash: "c1",
    front: [{
      type: "image",
      v: 1,
      id: "i1",
      payload: { media: MEDIA, width: 1, height: 1, boxes: [] },
    }],
    back: text("답"),
  }],
});
const imageParts = (fake: Fake) =>
  (fake.provider[0]?.content ?? []).filter((p) =>
    (p as { type: string }).type === "image_url"
  ) as { image_url: { url: string } }[];

Deno.test("a card's photo leaves as an image part read from the bucket", async () => {
  const { fake, handler } = setup({
    claim: withPhoto(),
    photos: { [MEDIA]: { type: "image/png", bytes: 1000 } },
  });
  await handler(post("", "user-token"));
  const images = imageParts(fake);
  assert.equal(images.length, 1);
  assert.equal(
    images[0]?.image_url.url.startsWith("data:image/png;base64,"),
    true,
  );
  assert.equal(aiOf(fake)?.outcome, "clean");
  const items = JSON.parse(
    (fake.provider[0]?.content[0] as { text: string }).text,
  )
    .items as { kind: string; n: number }[];
  assert.equal(items.some((i) => i.kind === "photo"), true);
});

Deno.test("a photo over the size sent is left out and the note is judged on the rest", async () => {
  const { fake, handler } = setup({
    claim: withPhoto(),
    photos: { [MEDIA]: { type: "image/png", bytes: 6_000_000 } },
  });
  await handler(post("", "user-token"));
  assert.deepEqual(models(fake), ["vendor/cheap"], "the note is still judged");
  assert.equal(imageParts(fake).length, 0, "no oversized photo is sent");
  assert.equal(aiOf(fake)?.outcome, "clean");
  const type = setup({
    claim: withPhoto(),
    photos: { [MEDIA]: { type: "image/gif", bytes: 1000 } },
  });
  await type.handler(post("", "user-token"));
  assert.equal(imageParts(type.fake).length, 0, "nor one of another type");
  assert.equal(aiOf(type.fake)?.outcome, "clean");
});

Deno.test("a photo the bucket does not answer holds the note and the log names the photo", async () => {
  const { fake, handler, logs } = setup({ claim: withPhoto() });
  await handler(post("", "user-token"));
  assert.deepEqual(fake.provider, []);
  assert.equal(aiOf(fake)?.version, "unavailable");
  assert.equal(
    logs.some((l) => l.route === "ai" && l.failure === "photo"),
    true,
  );
});
