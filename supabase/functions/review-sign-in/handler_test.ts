// The handler end to end, with the database and Supabase Auth replaced by a recording fake fetch.
// The suite runs without write or network permission, so a write anywhere fails the run.
import assert from "node:assert/strict";
import { same } from "../_shared/same.ts";
import { readConfig } from "./config.ts";
import {
  createHandler,
  type LogEntry,
  MIN_CODE,
  normalize,
} from "./handler.ts";

const SUPABASE_URL = "https://project.supabase.test";
const SERVICE_ROLE_KEY = "service-role-key";
const REVIEW_EMAIL = "review@example.com";
const REVIEW_CODE = "a-long-fixed-code";
const HASHED_TOKEN = "hashed-token-from-auth";

const ENV: Record<string, string> = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
};

type Fake = {
  /** What `review_sign_in_begin` answers: the verdict and the Vault secrets, or a status. */
  begin:
    | { allowed: boolean; email: string | null; code: string | null }
    | number
    | "offline";
  /** The admin API's answer to `generate_link`: a status, or a body with a hashed token. */
  link: number | "offline" | "no_token";
  calls: { url: string; headers: Headers; body: unknown }[];
};

const fake = (overrides: Partial<Fake> = {}): Fake => ({
  begin: { allowed: true, email: REVIEW_EMAIL, code: REVIEW_CODE },
  link: 200,
  calls: [],
  ...overrides,
});

function respond(
  state: Fake,
  input: string | URL | Request,
  init?: RequestInit,
): Response {
  {
    const url = String(input);
    const body: unknown = JSON.parse(String(init?.body));
    state.calls.push({ url, headers: new Headers(init?.headers), body });
    if (url === `${SUPABASE_URL}/rest/v1/rpc/review_sign_in_begin`) {
      if (state.begin === "offline") {
        throw new TypeError("error sending request");
      }
      if (typeof state.begin === "number") {
        return Response.json({}, { status: state.begin });
      }
      return Response.json([state.begin]);
    }
    if (url === `${SUPABASE_URL}/auth/v1/admin/generate_link`) {
      if (state.link === "offline") {
        throw new TypeError("error sending request");
      }
      if (state.link === "no_token") return Response.json({ email_otp: "1" });
      return state.link === 200
        ? Response.json({
          action_link: "https://x.test/verify?token=hash",
          email_otp: "123456",
          hashed_token: HASHED_TOKEN,
          verification_type: "magiclink",
          id: "00000000-0000-4000-8000-00000000000a",
        })
        : Response.json({}, { status: state.link });
    }
    throw new Error(`unexpected request ${url}`);
  }
}

const fakeFetch = (state: Fake): typeof fetch => (input, init) =>
  new Promise((resolve) => resolve(respond(state, input, init)));

async function call(
  state: Fake,
  body: unknown,
  options: { method?: string; env?: Record<string, string> } = {},
): Promise<{ response: Response; text: string; logs: LogEntry[] }> {
  const logs: LogEntry[] = [];
  const handler = createHandler({
    config: readConfig((name) => (options.env ?? ENV)[name]),
    fetch: fakeFetch(state),
    log: (entry) => logs.push(entry),
  });
  const response = await handler(
    new Request(`${SUPABASE_URL}/functions/v1/review-sign-in`, {
      method: options.method ?? "POST",
      body: options.method === "GET"
        ? null
        : typeof body === "string"
        ? body
        : JSON.stringify(body),
    }),
  );
  return { response, text: await response.clone().text(), logs };
}

const linkCalls = (state: Fake) =>
  state.calls.filter((c) => c.url.endsWith("/admin/generate_link"));

Deno.test("the review address with its code gets the token hash of an email sign-in", async () => {
  const state = fake();
  const { response, logs } = await call(state, {
    email: REVIEW_EMAIL,
    code: REVIEW_CODE,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    token_hash: HASHED_TOKEN,
    type: "email",
  });
  assert.deepEqual(logs, [{ outcome: "signed_in" }]);
  const [link] = linkCalls(state);
  assert.deepEqual(link?.body, { type: "magiclink", email: REVIEW_EMAIL });
  assert.equal(
    link?.headers.get("Authorization"),
    `Bearer ${SERVICE_ROLE_KEY}`,
  );
});

Deno.test("the address is read trimmed and in lower case, the code trimmed", async () => {
  const state = fake();
  const { response } = await call(state, {
    email: "  Review@Example.COM ",
    code: ` ${REVIEW_CODE}\n`,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(linkCalls(state)[0]?.body, {
    type: "magiclink",
    email: REVIEW_EMAIL,
  });
});

Deno.test("the attempt is recorded under the address's hash, never the address", async () => {
  const state = fake();
  await call(state, { email: "Review@Example.com", code: "x" });
  const [begin] = state.calls;
  assert.deepEqual(begin?.body, {
    address_key: Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(REVIEW_EMAIL),
        ),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join(""),
  });
});

Deno.test("another address with the right code is refused and signed in nowhere", async () => {
  const state = fake();
  const { response } = await call(state, {
    email: "someone@example.com",
    code: REVIEW_CODE,
  });
  assert.equal(response.status, 401);
  assert.equal(linkCalls(state).length, 0);
  const control = fake();
  const accepted = await call(control, {
    email: REVIEW_EMAIL,
    code: REVIEW_CODE,
  });
  assert.equal(
    accepted.response.status,
    200,
    "the review pair on the same fake",
  );
  assert.equal(linkCalls(control).length, 1);
});

Deno.test("the review address with another code is refused", async () => {
  const state = fake();
  const { response } = await call(state, {
    email: REVIEW_EMAIL,
    code: "a-long-fixed-cod3",
  });
  assert.equal(response.status, 401);
  assert.equal(linkCalls(state).length, 0);
  const control = fake();
  const accepted = await call(control, {
    email: REVIEW_EMAIL,
    code: REVIEW_CODE,
  });
  assert.equal(
    accepted.response.status,
    200,
    "the right code on the same fake",
  );
  assert.equal(linkCalls(control).length, 1);
});

Deno.test("a missing secret refuses every attempt, even the pair a person would type", async () => {
  const cases: Fake["begin"][] = [
    { allowed: true, email: null, code: null },
    { allowed: true, email: REVIEW_EMAIL, code: null },
    { allowed: true, email: null, code: REVIEW_CODE },
    { allowed: true, email: "", code: REVIEW_CODE },
    { allowed: true, email: REVIEW_EMAIL, code: "" },
  ];
  for (const begin of cases) {
    for (
      const attempt of [
        { email: REVIEW_EMAIL, code: REVIEW_CODE },
        { email: "", code: "" },
        { email: " ", code: "x" },
        { email: REVIEW_EMAIL, code: "x" },
      ]
    ) {
      const state = fake({ begin });
      const { response } = await call(state, attempt);
      assert.notEqual(response.status, 200, JSON.stringify([begin, attempt]));
      assert.equal(linkCalls(state).length, 0);
    }
  }
  const control = fake();
  const accepted = await call(control, {
    email: REVIEW_EMAIL,
    code: REVIEW_CODE,
  });
  assert.equal(accepted.response.status, 200, "with both secrets set");
  assert.equal(linkCalls(control).length, 1);
});

Deno.test("a code shorter than the minimum is no code, though the pair matches", async () => {
  const short = "x".repeat(MIN_CODE - 1);
  const state = fake({
    begin: { allowed: true, email: REVIEW_EMAIL, code: short },
  });
  const { response } = await call(state, { email: REVIEW_EMAIL, code: short });
  assert.equal(response.status, 401);
  assert.equal(linkCalls(state).length, 0);
  const exact = "x".repeat(MIN_CODE);
  const ok = fake({
    begin: { allowed: true, email: REVIEW_EMAIL, code: exact },
  });
  assert.equal(
    (await call(ok, { email: REVIEW_EMAIL, code: exact })).response.status,
    200,
  );
});

Deno.test("no answer tells the review address from another, or a missing secret", async () => {
  const refusals = [
    await call(fake(), { email: "other@example.com", code: REVIEW_CODE }),
    await call(fake(), { email: REVIEW_EMAIL, code: "wrong-wrong-wrong" }),
    await call(fake(), {
      email: "other@example.com",
      code: "wrong-wrong-wrong",
    }),
    await call(fake({ begin: { allowed: true, email: null, code: null } }), {
      email: REVIEW_EMAIL,
      code: REVIEW_CODE,
    }),
  ];
  for (const refusal of refusals) {
    assert.equal(refusal.response.status, 401);
    assert.equal(refusal.text, refusals[0]?.text);
    assert.deepEqual(refusal.logs, [{ outcome: "refused" }]);
  }
});

Deno.test("a limited attempt answers 429 with the wait, and reads and signs in nothing", async () => {
  const state = fake({ begin: { allowed: false, email: null, code: null } });
  const { response, text } = await call(state, {
    email: REVIEW_EMAIL,
    code: REVIEW_CODE,
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "600");
  assert.equal(linkCalls(state).length, 0);
  const other = await call(state, { email: "other@example.com", code: "x" });
  assert.equal(other.text, text, "the limit answers every address alike");
  const control = fake({
    begin: { allowed: true, email: REVIEW_EMAIL, code: REVIEW_CODE },
  });
  const accepted = await call(control, {
    email: REVIEW_EMAIL,
    code: REVIEW_CODE,
  });
  assert.equal(accepted.response.status, 200, "the same fake with allowed");
  assert.equal(linkCalls(control).length, 1);
});

Deno.test("a body that is not an address and a code is a bad request, before any call", async () => {
  for (
    const body of [
      "not json",
      null,
      [],
      {},
      { email: REVIEW_EMAIL },
      { email: 1, code: "x" },
      { email: REVIEW_EMAIL, code: 1 },
      { email: "", code: "x" },
      { email: "  ", code: "x" },
      { email: REVIEW_EMAIL, code: "" },
      { email: "a".repeat(255), code: "x" },
      { email: REVIEW_EMAIL, code: "x".repeat(129) },
    ]
  ) {
    const state = fake();
    const { response } = await call(state, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(state.calls.length, 0);
  }
  const control = fake();
  const accepted = await call(control, {
    email: REVIEW_EMAIL,
    code: REVIEW_CODE,
  });
  assert.equal(accepted.response.status, 200, "a well-formed body");
  assert.equal(
    control.calls[0]?.url,
    `${SUPABASE_URL}/rest/v1/rpc/review_sign_in_begin`,
    "reaches review_sign_in_begin",
  );
});

Deno.test("only POST is served, and an unconfigured function refuses", async () => {
  const get = await call(fake(), null, { method: "GET" });
  assert.equal(get.response.status, 405);
  const state = fake();
  const none = await call(
    state,
    { email: REVIEW_EMAIL, code: REVIEW_CODE },
    { env: {} },
  );
  assert.equal(none.response.status, 503);
  assert.equal(state.calls.length, 0);
  const control = fake();
  const configured = await call(control, {
    email: REVIEW_EMAIL,
    code: REVIEW_CODE,
  }, { env: ENV });
  assert.equal(configured.response.status, 200, "the same request with ENV");
});

Deno.test("an unreachable or failing database or Auth is a 502, not a sign-in", async () => {
  const pair = { email: REVIEW_EMAIL, code: REVIEW_CODE };
  for (const begin of ["offline", 500] as const) {
    const { response, logs } = await call(fake({ begin }), pair);
    assert.equal(response.status, 502);
    assert.deepEqual(logs, [{ outcome: "unavailable" }]);
  }
  for (const link of ["offline", 500, 422, "no_token"] as const) {
    const { response } = await call(fake({ link }), pair);
    assert.equal(response.status, 502, String(link));
  }
});

Deno.test("an answer in another shape is a 502", async () => {
  const state = fake({
    begin: { allowed: true, email: 5 as unknown as string, code: null },
  });
  const { response } = await call(state, {
    email: REVIEW_EMAIL,
    code: REVIEW_CODE,
  });
  assert.equal(response.status, 502);
});

Deno.test("nothing logged or answered holds the address, the code or the key", async () => {
  const outputs: string[] = [];
  for (
    const attempt of [
      { email: REVIEW_EMAIL, code: REVIEW_CODE },
      { email: REVIEW_EMAIL, code: "wrong-wrong-wrong" },
    ]
  ) {
    const { text, logs } = await call(fake(), attempt);
    outputs.push(JSON.stringify(logs), text.replace(HASHED_TOKEN, ""));
  }
  for (const output of outputs) {
    for (const secret of [REVIEW_EMAIL, REVIEW_CODE, SERVICE_ROLE_KEY]) {
      assert.ok(!output.includes(secret), output);
    }
  }
});

Deno.test("same compares whole texts, of any length, and normalize trims and lower-cases", async () => {
  assert.equal(await same("abc", "abc"), true);
  assert.equal(await same("abc", "abd"), false);
  assert.equal(await same("abc", "abcd"), false);
  assert.equal(await same("", ""), true);
  assert.equal(await same("", "a"), false);
  assert.equal(await same("한글", "한글"), true);
  assert.equal(normalize(" A@B.Co "), "a@b.co");
});
