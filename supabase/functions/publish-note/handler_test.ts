// The handler end to end, with the database and Supabase Auth replaced by a recording fake fetch.
import assert from "node:assert/strict";
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
  due: string[];
  requestStatus: number;
  recorded: Record<string, unknown>[];
  applied: Record<string, unknown>[];
  calls: { name: string; bearer: string | null; key: string | null }[];
};

const text = (value: string) => [{
  type: "text",
  v: 1,
  id: "b1",
  payload: { text: value },
}];

function claimOf(front: string, verdicts: unknown[] = []) {
  return {
    hash: "hash-1",
    publication: "checking",
    name: "단어",
    description: null,
    cards: [{ hash: "c1", front: text(front), back: text("답") }],
    terms: [],
    terms_version: "0.0",
    verdicts,
  };
}

function setup(over: Partial<Fake> = {}) {
  const fake: Fake = {
    claim: claimOf("apple"),
    due: [],
    requestStatus: 200,
    recorded: [],
    applied: [],
    calls: [],
    ...over,
  };
  const logs: Record<string, unknown>[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url = new URL(String(input));
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
        return Promise.resolve(Response.json(fake.claim));
      case "record_screening":
        fake.recorded.push(body);
        return Promise.resolve(Response.json("recorded"));
      case "apply_screening":
        fake.applied.push(body);
        return Promise.resolve(Response.json("public"));
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
  assert.equal(fake.recorded.length, 1);
  assert.equal(fake.recorded[0]?.layer, "rules");
  assert.equal(fake.recorded[0]?.outcome, "clean");
  assert.equal(fake.recorded[0]?.version, "1+0.0");
  assert.deepEqual(fake.applied, [{ deck_id: DECK, content_hash: "hash-1" }]);
});

Deno.test("a verdict of the rules records its findings and no text", async () => {
  const { fake, handler } = setup({ claim: claimOf("010-1234-5678") });
  await handler(post("", "user-token"));
  assert.equal(fake.recorded[0]?.outcome, "refused");
  assert.equal(JSON.stringify(fake.recorded[0]).includes("1234"), false);
});

Deno.test("a verdict of this version is not made again", async () => {
  const { fake, handler } = setup({
    claim: claimOf("apple", [{
      layer: "rules",
      version: "1+0.0",
      outcome: "clean",
    }]),
  });
  await handler(post("", "user-token"));
  assert.equal(fake.recorded.length, 0);
  assert.equal(fake.applied.length, 1);
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
    log: () => {},
  });
  assert.equal((await bare(post("", "user-token"))).status, 503);
});
