// The handler end to end, with the database and RevenueCat's REST API replaced by a recording fake
// fetch. The suite runs without write or network permission, so a write anywhere fails the run.
import assert from "node:assert/strict";
import { readConfig } from "./config.ts";
import { createHandler, type LogEntry } from "./handler.ts";

const SUPABASE_URL = "https://project.supabase.test";
const SERVICE_ROLE_KEY = "service-role-key";
const AUTHORIZATION = "Bearer webhook-value-from-vault";
const API_KEY = "sk_revenuecat_secret";
const USER = "00000000-0000-4000-8000-00000000000b";
const OTHER = "00000000-0000-4000-8000-00000000000c";
const NOW = Date.parse("2026-11-10T12:00:00Z");
const FUTURE = "2026-12-10T12:00:00Z";
const PAST = "2026-11-01T12:00:00Z";

const ENV: Record<string, string> = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
};

type Fake = {
  /** What `store_secrets` answers, or a status. */
  secrets:
    | { webhook_authorization: string | null; api_key: string | null }
    | number
    | "offline";
  /** RevenueCat's answer: the subscriber's JSON, a status, or "offline". */
  revenuecat: unknown | number | "offline";
  /** What `apply_store_entitlement` answers, or a status. */
  apply: string | number | "offline";
  /** RevenueCat's answer for another user id, by id; a user with none is not served. */
  others?: Record<string, unknown>;
  calls: { url: string; headers: Headers; body: unknown }[];
};

/** A subscriber with the entitlement `plus` as RevenueCat answers it. */
const subscriber = (
  entitlement: Record<string, unknown> | null,
  subscription: Record<string, unknown> = {
    expires_date: FUTURE,
    unsubscribe_detected_at: null,
  },
) => ({
  request_date_ms: NOW,
  subscriber: {
    entitlements: entitlement === null ? {} : {
      plus: { product_identifier: "plus_monthly", ...entitlement },
    },
    subscriptions: { plus_monthly: subscription },
  },
});

const fake = (overrides: Partial<Fake> = {}): Fake => ({
  secrets: { webhook_authorization: AUTHORIZATION, api_key: API_KEY },
  revenuecat: subscriber({ expires_date: FUTURE }),
  apply: "granted",
  calls: [],
  ...overrides,
});

function respond(
  state: Fake,
  input: string | URL | Request,
  init?: RequestInit,
): Response {
  const url = String(input);
  const body: unknown = JSON.parse(String(init?.body ?? "null"));
  state.calls.push({ url, headers: new Headers(init?.headers), body });
  if (url === `${SUPABASE_URL}/rest/v1/rpc/store_secrets`) {
    if (state.secrets === "offline") throw new TypeError("error sending");
    if (typeof state.secrets === "number") {
      return Response.json({}, { status: state.secrets });
    }
    return Response.json([state.secrets]);
  }
  if (url === `${SUPABASE_URL}/rest/v1/rpc/apply_store_entitlement`) {
    if (state.apply === "offline") throw new TypeError("error sending");
    if (typeof state.apply === "number") {
      return Response.json({}, { status: state.apply });
    }
    return Response.json(state.apply);
  }
  if (url === `https://api.revenuecat.com/v1/subscribers/${USER}`) {
    if (state.revenuecat === "offline") throw new TypeError("error sending");
    if (typeof state.revenuecat === "number") {
      return Response.json({}, { status: state.revenuecat });
    }
    return Response.json(state.revenuecat);
  }
  const other = Object.entries(state.others ?? {}).find(([id]) =>
    url === `https://api.revenuecat.com/v1/subscribers/${id}`
  );
  if (other !== undefined) return Response.json(other[1]);
  throw new Error(`unexpected request ${url}`);
}

const fakeFetch = (state: Fake): typeof fetch => (input, init) =>
  new Promise((resolve) => resolve(respond(state, input, init)));

const event = (overrides: Record<string, unknown> = {}) => ({
  api_version: "1.0",
  event: {
    type: "INITIAL_PURCHASE",
    app_user_id: USER,
    environment: "PRODUCTION",
    ...overrides,
  },
});

async function call(
  state: Fake,
  body: unknown = event(),
  options: {
    method?: string;
    env?: Record<string, string>;
    authorization?: string | null;
  } = {},
): Promise<{ response: Response; text: string; logs: LogEntry[] }> {
  const logs: LogEntry[] = [];
  const handler = createHandler({
    config: readConfig((name) => (options.env ?? ENV)[name]),
    fetch: fakeFetch(state),
    now: () => NOW,
    log: (entry) => logs.push(entry),
  });
  const authorization = options.authorization === undefined
    ? AUTHORIZATION
    : options.authorization;
  const response = await handler(
    new Request(`${SUPABASE_URL}/functions/v1/store-webhook`, {
      method: options.method ?? "POST",
      headers: authorization === null ? {} : { Authorization: authorization },
      body: options.method === "GET"
        ? null
        : typeof body === "string"
        ? body
        : JSON.stringify(body),
    }),
  );
  return { response, text: await response.clone().text(), logs };
}

const applies = (state: Fake) =>
  state.calls.filter((c) => c.url.endsWith("/apply_store_entitlement"));
const reads = (state: Fake) =>
  state.calls.filter((c) => c.url.startsWith("https://api.revenuecat.com/"));

Deno.test("a purchase reads the user's entitlements and grants Pro until their end, renewing", async () => {
  const state = fake();
  const { response, logs } = await call(state);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    outcome: "applied",
    result: "granted",
  });
  assert.deepEqual(logs, [{ outcome: "applied", result: "granted" }]);
  const [read] = reads(state);
  assert.equal(read?.headers.get("Authorization"), `Bearer ${API_KEY}`);
  assert.deepEqual(applies(state).map((c) => c.body), [{
    user_id: USER,
    plan: "pro",
    ends_at: FUTURE.replace("Z", ".000Z"),
    renews: true,
  }]);
});

Deno.test("the plan comes from the read, not from the event: a cancellation event whose read still shows the entitlement keeps it", async () => {
  const state = fake({ apply: "unchanged" });
  const { response } = await call(state, event({ type: "EXPIRATION" }));
  assert.deepEqual(await response.json(), {
    outcome: "applied",
    result: "unchanged",
  });
  assert.equal((applies(state)[0]?.body as { plan: string }).plan, "pro");
});

Deno.test("each outcome of the database is passed on", async () => {
  for (const result of ["granted", "changed", "ended", "unchanged"]) {
    const { response } = await call(fake({ apply: result }));
    assert.equal(response.status, 200, result);
    assert.deepEqual(await response.json(), { outcome: "applied", result });
  }
});

Deno.test("no entitlement ends the grant, whatever the event", async () => {
  for (
    const type of ["EXPIRATION", "CANCELLATION", "REFUND", "BILLING_ISSUE"]
  ) {
    const state = fake({ revenuecat: subscriber(null), apply: "ended" });
    const { response } = await call(state, event({ type }));
    assert.deepEqual(await response.json(), {
      outcome: "applied",
      result: "ended",
    }, type);
    assert.deepEqual(applies(state).map((c) => c.body), [{
      user_id: USER,
      plan: null,
      ends_at: null,
      renews: false,
    }], type);
  }
});

Deno.test("an entitlement whose end has passed ends the grant", async () => {
  const state = fake({
    revenuecat: subscriber({ expires_date: PAST }),
    apply: "ended",
  });
  await call(state);
  assert.equal((applies(state)[0]?.body as { plan: unknown }).plan, null);
});

Deno.test("a grace period keeps an expired entitlement until the grace ends", async () => {
  const state = fake({
    revenuecat: subscriber({
      expires_date: PAST,
      grace_period_expires_date: FUTURE,
    }),
  });
  await call(state);
  const body = applies(state)[0]?.body as { plan: string; ends_at: string };
  assert.equal(body.plan, "pro");
  assert.equal(body.ends_at, FUTURE.replace("Z", ".000Z"));
  const over = fake({
    revenuecat: subscriber({
      expires_date: PAST,
      grace_period_expires_date: PAST,
    }),
    apply: "ended",
  });
  await call(over);
  assert.equal((applies(over)[0]?.body as { plan: unknown }).plan, null);
});

Deno.test("an entitlement with no end is Pro with no end and no renewal; an unsubscribe stops the renewal", async () => {
  const forever = fake({ revenuecat: subscriber({ expires_date: null }) });
  await call(forever);
  assert.deepEqual(applies(forever)[0]?.body, {
    user_id: USER,
    plan: "pro",
    ends_at: null,
    renews: false,
  });
  const unsubscribed = fake({
    revenuecat: subscriber({ expires_date: FUTURE }, {
      expires_date: FUTURE,
      unsubscribe_detected_at: PAST,
    }),
  });
  await call(unsubscribed);
  assert.equal(
    (applies(unsubscribed)[0]?.body as { renews: boolean }).renews,
    false,
  );
});

Deno.test("a sandbox event grants like any other", async () => {
  const state = fake();
  const { response } = await call(state, event({ environment: "SANDBOX" }));
  assert.deepEqual(await response.json(), {
    outcome: "applied",
    result: "granted",
  });
  assert.equal(applies(state).length, 1);
});

Deno.test("a call whose Authorization differs from the Vault value is refused, and nothing is read or set", async () => {
  for (
    const authorization of [
      "bearer webhook-value-from-vault",
      "Bearer other",
      "",
      null,
    ]
  ) {
    const state = fake();
    const { response, logs } = await call(state, event(), { authorization });
    assert.equal(response.status, 401, String(authorization));
    assert.deepEqual(await response.json(), { outcome: "unauthorized" });
    assert.deepEqual(logs, [{ outcome: "unauthorized" }]);
    assert.equal(reads(state).length, 0);
    assert.equal(applies(state).length, 0);
  }
  const control = fake();
  const { response } = await call(control);
  assert.equal(response.status, 200, "control: the Vault value is accepted");
  assert.equal(applies(control).length, 1);
});

Deno.test("an unset Authorization value refuses every call, an empty header included", async () => {
  for (const authorization of ["", AUTHORIZATION, null]) {
    const state = fake({
      secrets: { webhook_authorization: null, api_key: API_KEY },
    });
    const { response } = await call(state, event(), { authorization });
    assert.equal(response.status, 401);
    assert.equal(reads(state).length, 0);
  }
});

Deno.test("an unknown user is answered 200", async () => {
  const state = fake({ apply: "no_user" });
  const { response } = await call(state);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { outcome: "no_user" });
});

Deno.test("an event to ignore is answered 200 and read nowhere", async () => {
  const bodies: unknown[] = [
    event({ type: "TEST" }),
    event({ app_user_id: "$RCAnonymousID:abc" }),
    event({ app_user_id: undefined }),
    event({ app_user_id: 7 }),
    { api_version: "1.0" },
    { event: "no" },
    [],
    "not json",
    "null",
  ];
  for (const body of bodies) {
    const state = fake();
    const { response, logs } = await call(state, body);
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(await response.json(), { outcome: "ignored" });
    assert.deepEqual(logs, [{ outcome: "ignored" }]);
    assert.equal(reads(state).length, 0);
    assert.equal(applies(state).length, 0);
  }
});

Deno.test("a RevenueCat failure answers non-200, so RevenueCat retries, and sets nothing", async () => {
  const failures: unknown[] = [
    500,
    429,
    401,
    404,
    "offline",
    { subscriber: {} },
    { subscriber: { entitlements: { plus: "x" } } },
    { subscriber: { entitlements: { plus: { expires_date: "soon" } } } },
    "text",
  ];
  for (const revenuecat of failures) {
    const state = fake({ revenuecat });
    const { response, logs, text } = await call(state);
    assert.equal(response.status, 502, JSON.stringify(revenuecat));
    assert.deepEqual(logs, [{ outcome: "unavailable" }]);
    assert.equal(applies(state).length, 0);
    assert.equal(text.includes(API_KEY), false, "no secret in the answer");
  }
});

Deno.test("a database failure answers non-200, and so does an outcome the function does not know", async () => {
  for (const apply of [500, "offline", "bad_plan"]) {
    const { response } = await call(fake({ apply }));
    assert.equal(response.status, 502, String(apply));
  }
  for (const secrets of [500, "offline"] as const) {
    const state = fake({ secrets });
    const { response } = await call(state);
    assert.equal(response.status, 502);
    assert.equal(reads(state).length, 0);
  }
});

Deno.test("an unset API key answers 503 after the header is checked, so RevenueCat retries", async () => {
  const state = fake({
    secrets: { webhook_authorization: AUTHORIZATION, api_key: null },
  });
  const { response } = await call(state);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { outcome: "not_configured" });
  assert.equal(reads(state).length, 0);
  const refused = await call(state, event(), { authorization: "Bearer other" });
  assert.equal(refused.response.status, 401, "a bad header is still refused");
});

Deno.test("a missing environment answers 503 and anything but POST 405, reading nothing", async () => {
  const state = fake();
  const missing = await call(state, event(), { env: {} });
  assert.equal(missing.response.status, 503);
  const get = await call(state, null, { method: "GET" });
  assert.equal(get.response.status, 405);
  assert.equal(state.calls.length, 0);
});

Deno.test("the log and the answers carry no secret and no user id", async () => {
  const state = fake();
  const { text, logs } = await call(state);
  const everything = text + JSON.stringify(logs);
  for (const secret of [AUTHORIZATION, API_KEY, SERVICE_ROLE_KEY, USER]) {
    assert.equal(everything.includes(secret), false, secret);
  }
});

const transfer = (from: unknown, to: unknown) => ({
  api_version: "1.0",
  event: { type: "TRANSFER", transferred_from: from, transferred_to: to },
});

Deno.test("a transfer reads and applies every id it names: the loser ends and the gainer is granted", async () => {
  const state = fake({
    revenuecat: subscriber(null),
    others: { [OTHER]: subscriber({ expires_date: FUTURE }) },
    apply: "ended",
  });
  const { response, logs } = await call(state, transfer([USER], [OTHER]));
  assert.equal(response.status, 200);
  assert.deepEqual(
    reads(state).map((c) => c.url.split("/").pop()),
    [USER, OTHER],
  );
  const bodies = applies(state).map((c) => c.body as Record<string, unknown>);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].user_id, USER);
  assert.equal(bodies[0].plan, null);
  assert.equal(bodies[1].user_id, OTHER);
  assert.equal(bodies[1].plan, "pro");
  assert.deepEqual(logs, [{ outcome: "applied", result: "ended,ended" }]);
});

Deno.test("a transfer ignores an id that is not a user id and reads nothing for it, and one with none is ignored", async () => {
  const state = fake({ revenuecat: subscriber(null), apply: "ended" });
  const { response } = await call(
    state,
    transfer(["$RCAnonymousID:abc", USER, USER.toUpperCase()], [7, null]),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(reads(state).map((c) => c.url.split("/").pop()), [USER]);
  assert.equal(applies(state).length, 1);
  for (const body of [transfer(["$RCAnonymousID:abc"], []), transfer(1, "x")]) {
    const none = fake();
    const { response: r } = await call(none, body);
    assert.deepEqual(await r.json(), { outcome: "ignored" });
    assert.equal(reads(none).length, 0);
  }
});

Deno.test("a transfer whose read fails for one id answers non-200 and changes no grant", async () => {
  const state = fake({ revenuecat: subscriber(null) });
  const failing = fakeFetch(state);
  const handler = createHandler({
    config: readConfig((name) => ENV[name]),
    fetch: (input, init) =>
      String(input).endsWith(OTHER)
        ? Promise.resolve(Response.json({}, { status: 500 }))
        : failing(input, init),
    now: () => NOW,
    log: () => {},
  });
  const response = await handler(
    new Request(`${SUPABASE_URL}/functions/v1/store-webhook`, {
      method: "POST",
      headers: { Authorization: AUTHORIZATION },
      body: JSON.stringify(transfer([USER], [OTHER])),
    }),
  );
  assert.equal(response.status, 502);
  assert.equal(applies(state).length, 0);
});
