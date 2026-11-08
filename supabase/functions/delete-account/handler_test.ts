// The handler end to end, with Supabase Auth replaced by a recording fake fetch.
// The suite runs without write or network permission, so a write anywhere fails the run.
import assert from "node:assert/strict";
import { readConfig } from "./config.ts";
import { createHandler, type LogEntry } from "./handler.ts";

const SUPABASE_URL = "https://project.supabase.test";
const SERVICE_ROLE_KEY = "service-role-key";
const ADA = "00000000-0000-4000-8000-00000000000a";
const GRACE = "00000000-0000-4000-8000-00000000000b";

/** The users the fake Auth server knows, by the bearer token that signs each in. */
const TOKENS: Record<string, { id: string; is_anonymous?: boolean }> = {
  "Bearer ada-token": { id: ADA },
  "Bearer grace-token": { id: GRACE },
  "Bearer anonymous-sign-in": { id: ADA, is_anonymous: true },
};

const ENV: Record<string, string> = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
};

const APPLE_URL = "https://appleid.apple.com";
const NOW = Date.parse("2026-11-09T00:00:00Z");

/** The Sign in with Apple key of the tests: made here, so no real key is read, and its public half. */
const KEYS = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const PEM = `-----BEGIN PRIVATE KEY-----\n${
  btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.exportKey("pkcs8", KEYS.privateKey),
      ),
    ),
  )
}\n-----END PRIVATE KEY-----`;

const APPLE_ENV: Record<string, string> = {
  APPLE_TEAM_ID: "TEAM123456",
  APPLE_KEY_ID: "KEY1234567",
  APPLE_CLIENT_ID: "app.knowno",
  APPLE_PRIVATE_KEY: PEM,
};

/** Apple's subject for Ada, as her identity in Supabase Auth and the identity token name it. */
const ADA_APPLE = "001234.abcdef.5678";

/** An identity token's payload, unsigned: the function reads only its `sub`. */
const idToken = (sub: string) =>
  `e30.${btoa(JSON.stringify({ sub })).replaceAll("=", "")}.sig`;

type Fake = {
  /** The admin API's answer to a delete, or "offline" for a request that never arrives. */
  admin: number | "offline";
  /** Auth's answer to the user lookup when it is not the user's. */
  lookup: number | null;
  /** Storage's answer to a listing or a delete, or "offline" for a request that never arrives. */
  storage: number | "offline";
  /** The names of the objects in the media bucket, and in the chat photos' bucket. */
  objects: Set<string>;
  photos: Set<string>;
  calls: {
    url: string;
    method: string;
    headers: Headers;
    form: URLSearchParams | null;
  }[];
  /** The identities Supabase Auth holds for the user, as its admin API lists them. */
  identities: unknown[];
  /** Apple's answer to `/auth/token` and `/auth/revoke`, or "offline" for a request that never arrives. */
  apple: { token: number | "offline"; revoke: number | "offline"; sub: string };
};

/** Storage's listing and deletion over [fake.objects], as its HTTP API answers them. */
async function fakeStorage(
  fake: Fake,
  url: string,
  method: string,
  body: BodyInit | null | undefined,
): Promise<Response> {
  if (fake.storage === "offline") throw new TypeError("error sending request");
  if (fake.storage !== 200) return Response.json({}, { status: fake.storage });
  const request = JSON.parse(await new Response(body).text());
  const bucket = url.match(/\/storage\/v1\/object\/(?:list\/)?([^/]+)$/)?.[1];
  const objects = bucket === "assistant-photos" ? fake.photos : fake.objects;
  if (bucket !== "media" && bucket !== "assistant-photos") {
    throw new Error(`unexpected bucket in ${url}`);
  }
  if (
    method === "POST" &&
    url === `${SUPABASE_URL}/storage/v1/object/list/${bucket}`
  ) {
    const names = [...objects]
      .filter((name) => name.startsWith(`${request.prefix}/`))
      .slice(request.offset, request.offset + request.limit)
      .map((name) => ({ name: name.slice(request.prefix.length + 1) }));
    return Response.json(names);
  }
  if (
    method === "DELETE" && url === `${SUPABASE_URL}/storage/v1/object/${bucket}`
  ) {
    const gone: string[] = request.prefixes.filter((name: string) =>
      objects.delete(name)
    );
    return Response.json(gone.map((name) => ({ name })));
  }
  throw new Error(`unexpected storage request ${method} ${url}`);
}

function fakeFetch(fake: Fake): typeof fetch {
  return (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    fake.calls.push({
      url,
      method,
      headers,
      form: init?.body instanceof URLSearchParams ? init.body : null,
    });
    if (
      url === `${APPLE_URL}/auth/token` || url === `${APPLE_URL}/auth/revoke`
    ) {
      const answer = url.endsWith("token")
        ? fake.apple.token
        : fake.apple.revoke;
      if (answer === "offline") {
        return Promise.reject(new TypeError("error sending request"));
      }
      return Promise.resolve(
        answer !== 200
          ? Response.json({ error: "invalid_grant" }, { status: answer })
          : url.endsWith("token")
          ? Response.json({
            refresh_token: "apple-refresh-token",
            id_token: idToken(fake.apple.sub),
          })
          : new Response(null, { status: 200 }),
      );
    }
    if (url === `${SUPABASE_URL}/auth/v1/user`) {
      if (fake.lookup !== null) {
        return Promise.resolve(new Response(null, { status: fake.lookup }));
      }
      const user = TOKENS[headers.get("Authorization") ?? ""];
      return Promise.resolve(
        user === undefined
          ? Response.json({ code: 403 }, { status: 403 })
          : Response.json({ ...user, role: "authenticated" }),
      );
    }
    if (url.startsWith(`${SUPABASE_URL}/auth/v1/admin/users/`)) {
      if (method === "GET") {
        return Promise.resolve(
          Response.json({ id: ADA, identities: fake.identities }),
        );
      }
      if (fake.admin === "offline") {
        return Promise.reject(new TypeError("error sending request"));
      }
      return Promise.resolve(Response.json({}, { status: fake.admin }));
    }
    if (url.startsWith(`${SUPABASE_URL}/storage/v1/`)) {
      return fakeStorage(fake, url, method, init?.body);
    }
    throw new Error(`unexpected request to ${url}`);
  };
}

type Run = {
  status: number;
  text: string;
  logs: LogEntry[];
  console: string[];
  deleted: string[];
  fake: Fake;
};

async function run(
  options: {
    authorization?: string | null;
    method?: string;
    body?: string;
    admin?: number | "offline";
    lookup?: number;
    storage?: number | "offline";
    objects?: string[];
    photos?: string[];
    env?: Record<string, string | undefined>;
    identities?: unknown[];
    apple?: Partial<Fake["apple"]>;
  } = {},
): Promise<Run> {
  const fake: Fake = {
    admin: options.admin ?? 200,
    lookup: options.lookup ?? null,
    storage: options.storage ?? 200,
    objects: new Set(options.objects ?? []),
    photos: new Set(options.photos ?? []),
    calls: [],
    identities: options.identities ?? [{ provider: "google" }],
    apple: { token: 200, revoke: 200, sub: ADA_APPLE, ...options.apple },
  };
  const env = { ...ENV, ...options.env };
  const logs: LogEntry[] = [];
  const handler = createHandler({
    config: readConfig((name) => env[name]),
    fetch: fakeFetch(fake),
    now: () => NOW,
    log: (entry) => logs.push(entry),
  });
  const headers = new Headers();
  const authorization = options.authorization === undefined
    ? "Bearer ada-token"
    : options.authorization;
  if (authorization !== null) headers.set("Authorization", authorization);
  const method = options.method ?? "POST";
  const request = new Request("https://functions.test/delete-account", {
    method,
    headers,
    body: method === "POST" ? options.body : undefined,
  });

  const printed: string[] = [];
  const saved = { ...console };
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    console[level] = (...args: unknown[]) =>
      printed.push(args.map(String).join(" "));
  }
  let response: Response;
  try {
    response = await handler(request);
  } finally {
    Object.assign(console, saved);
  }
  return {
    status: response.status,
    text: await response.text(),
    logs,
    console: printed,
    deleted: fake.calls
      .filter((call) =>
        call.method === "DELETE" && call.url.includes("/auth/v1/admin/users/")
      )
      .map((call) => call.url.slice(call.url.lastIndexOf("/") + 1)),
    fake,
  };
}

Deno.test("the suite runs without write or network permission", () => {
  assert.notEqual(
    Deno.permissions.querySync({ name: "write" }).state,
    "granted",
  );
  assert.notEqual(Deno.permissions.querySync({ name: "net" }).state, "granted");
});

Deno.test("a signed-in user is deleted through the admin API with the service-role key, and answered 204", async () => {
  const r = await run();
  assert.equal(r.status, 204);
  assert.equal(r.text, "");
  assert.deepEqual(r.deleted, [ADA]);
  const call = r.fake.calls.find((c) =>
    c.method === "DELETE" && c.url.includes("/auth/v1/")
  )!;
  assert.equal(call.url, `${SUPABASE_URL}/auth/v1/admin/users/${ADA}`);
  assert.equal(call.headers.get("apikey"), SERVICE_ROLE_KEY);
  assert.equal(call.headers.get("Authorization"), `Bearer ${SERVICE_ROLE_KEY}`);
});

Deno.test("a request without a signed-in user is refused with 401 and deletes no one", async () => {
  for (
    const authorization of [
      null,
      "Bearer anon-key",
      "Bearer anonymous-sign-in",
      "Basic ada-token",
    ]
  ) {
    const r = await run({ authorization });
    assert.equal(r.status, 401, `authorization ${authorization}`);
    assert.deepEqual(JSON.parse(r.text), { error: "unauthenticated" });
    assert.deepEqual(r.deleted, []);
  }
  const control = await run();
  assert.equal(control.status, 204, "control: the signed-in token is accepted");
  assert.deepEqual(control.deleted, [ADA]);
});

Deno.test("the user deleted is the token's, whatever id the body names", async () => {
  for (
    const body of [
      JSON.stringify({ user_id: GRACE }),
      JSON.stringify({ id: GRACE, userId: GRACE }),
      GRACE,
      "not json",
    ]
  ) {
    const r = await run({ body });
    assert.equal(r.status, 204, body);
    assert.deepEqual(r.deleted, [ADA], `body ${body} deletes the caller only`);
  }
  // The control: the id comes from the token, so Grace's token deletes Grace.
  const control = await run({
    authorization: "Bearer grace-token",
    body: JSON.stringify({ user_id: ADA }),
  });
  assert.deepEqual(control.deleted, [GRACE]);
});

Deno.test("a deletion the admin API refuses or never receives answers 502", async () => {
  for (const admin of [500, 404, "offline"] as const) {
    const r = await run({ admin });
    assert.equal(r.status, 502, `admin ${admin}`);
    assert.deepEqual(JSON.parse(r.text), { error: "delete_failed" });
    assert.deepEqual(r.logs, [{
      user_id: ADA,
      outcome: "delete_failed",
      apple: "none",
    }]);
  }
});

Deno.test("the user's media objects are deleted page by page before the user, and no one else's", async () => {
  const own = Array.from(
    { length: 1001 },
    (_, i) => `${ADA}/e0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );
  const other = `${GRACE}/e0000000-0000-4000-8000-000000000001`;
  const r = await run({ objects: [...own, other] });
  assert.equal(r.status, 204);
  assert.deepEqual([...r.fake.objects], [other], "only Grace's object is left");
  assert.deepEqual(r.deleted, [ADA]);
  const storageDeletes = r.fake.calls
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.method === "DELETE" && c.url.includes("/storage/v1/"));
  assert.equal(storageDeletes.length, 2, "1001 objects take two pages of 1000");
  for (const { c } of storageDeletes) {
    assert.equal(c.headers.get("Authorization"), `Bearer ${SERVICE_ROLE_KEY}`);
  }
  const userDelete = r.fake.calls.findIndex((c) =>
    c.url.includes("/auth/v1/admin/users/")
  );
  assert.ok(
    storageDeletes.every(({ i }) => i < userDelete),
    "the objects go before the user",
  );
});

Deno.test("the user's chat photos are deleted before the user, and no one else's", async () => {
  const own = `${ADA}/e0000000-0000-4000-8000-000000000001`;
  const other = `${GRACE}/e0000000-0000-4000-8000-000000000002`;
  const r = await run({ photos: [own, other] });
  assert.equal(r.status, 204);
  assert.deepEqual([...r.fake.photos], [other], "only Grace's photo is left");
  const photoDelete = r.fake.calls.findIndex((c) =>
    c.method === "DELETE" &&
    c.url.endsWith("/storage/v1/object/assistant-photos")
  );
  const userDelete = r.fake.calls.findIndex((c) =>
    c.url.includes("/auth/v1/admin/users/")
  );
  assert.ok(photoDelete !== -1 && photoDelete < userDelete);
});

Deno.test("a media deletion Storage refuses or never receives answers 502 and deletes no user", async () => {
  for (const storage of [500, 403, "offline"] as const) {
    const r = await run({ storage, objects: [`${ADA}/e`] });
    assert.equal(r.status, 502, `storage ${storage}`);
    assert.deepEqual(JSON.parse(r.text), { error: "delete_failed" });
    assert.deepEqual(r.deleted, [], `storage ${storage} deletes no user`);
  }
  const control = await run({ objects: [`${ADA}/e`] });
  assert.equal(
    control.status,
    204,
    "control: Storage answering deletes the user",
  );
  assert.deepEqual(control.deleted, [ADA]);
});

Deno.test("a user lookup that fails answers 502 without deleting", async () => {
  const r = await run({ lookup: 500 });
  assert.equal(r.status, 502);
  assert.deepEqual(JSON.parse(r.text), { error: "delete_failed" });
  assert.deepEqual(r.deleted, []);
});

Deno.test("a method other than POST is refused with 405", async () => {
  const r = await run({ method: "GET" });
  assert.equal(r.status, 405);
  assert.equal(r.fake.calls.length, 0);
});

Deno.test("a missing platform variable answers 503 before any call", async () => {
  for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const r = await run({ env: { [name]: undefined } });
    assert.equal(r.status, 503, name);
    assert.deepEqual(JSON.parse(r.text), { error: "not_configured" });
    assert.equal(r.fake.calls.length, 0);
  }
});

Deno.test("each request logs exactly its user and outcome, and prints nothing else", async () => {
  const deleted = await run();
  assert.deepEqual(deleted.logs, [{
    user_id: ADA,
    outcome: "deleted",
    apple: "none",
  }]);
  const refused = await run({ authorization: "Bearer anon-key" });
  assert.deepEqual(refused.logs, [{
    user_id: null,
    outcome: "unauthenticated",
    apple: null,
  }]);
  for (const r of [deleted, refused]) {
    assert.deepEqual(r.console, []);
  }
});

Deno.test("an unexpected failure logs internal and propagates", async () => {
  const logs: LogEntry[] = [];
  const handler = createHandler({
    config: readConfig((name) => ENV[name]),
    fetch: () => {
      throw new RangeError("a bug");
    },
    now: () => NOW,
    log: (entry) => logs.push(entry),
  });
  await assert.rejects(
    handler(
      new Request("https://functions.test/delete-account", {
        method: "POST",
        headers: { Authorization: "Bearer ada-token" },
      }),
    ),
    RangeError,
  );
  assert.deepEqual(logs, [{ user_id: null, outcome: "internal", apple: null }]);
});

const APPLE_IDENTITY = [{
  provider: "apple",
  identity_data: { sub: ADA_APPLE },
}];

/** What the run sent Apple: each call's path and form, in order. */
const sentToApple = (r: Run) =>
  r.fake.calls.filter((call) => call.url.startsWith(APPLE_URL)).map((call) => ({
    path: call.url.slice(APPLE_URL.length),
    form: Object.fromEntries(call.form ?? []),
  }));

/** The position of the first call to [url] with [method], or -1. */
const at = (r: Run, url: string, method: string) =>
  r.fake.calls.findIndex((call) =>
    call.url.startsWith(url) && call.method === method
  );

function revoking(body: unknown = { apple_authorization_code: "code-1" }) {
  return {
    body: JSON.stringify(body),
    identities: APPLE_IDENTITY,
    env: APPLE_ENV,
  };
}

Deno.test("an account with an Apple identity has its refresh token revoked, the code exchanged and the user deleted after, with the client secret signed by the key", async () => {
  const r = await run(revoking());
  assert.equal(r.status, 204);
  assert.deepEqual(r.deleted, [ADA]);
  assert.deepEqual(r.logs.map((entry) => entry.apple), ["revoked"]);
  const [token, revoke] = sentToApple(r);
  assert.equal(token!.path, "/auth/token");
  assert.equal(token!.form.grant_type, "authorization_code");
  assert.equal(token!.form.code, "code-1");
  assert.equal(token!.form.client_id, "app.knowno");
  assert.equal(revoke!.path, "/auth/revoke");
  assert.equal(revoke!.form.token, "apple-refresh-token");
  assert.equal(revoke!.form.token_type_hint, "refresh_token");
  assert.equal(revoke!.form.client_id, "app.knowno");
  assert.ok(
    at(r, APPLE_URL, "POST") <
      at(r, `${SUPABASE_URL}/auth/v1/admin/users/`, "DELETE"),
  );
  // The client secret: ES256 with the key id, the team, the client and Apple as audience.
  const [head, claims, signature] = token!.form.client_secret!.split(".") as [
    string,
    string,
    string,
  ];
  const decode = (part: string) =>
    JSON.parse(atob(part.replaceAll("-", "+").replaceAll("_", "/")));
  assert.deepEqual(decode(head), { alg: "ES256", kid: "KEY1234567" });
  assert.deepEqual(decode(claims), {
    iss: "TEAM123456",
    iat: NOW / 1000,
    exp: NOW / 1000 + 300,
    aud: APPLE_URL,
    sub: "app.knowno",
  });
  const bytes = Uint8Array.from(
    atob(signature.replaceAll("-", "+").replaceAll("_", "/")),
    (char) => char.charCodeAt(0),
  );
  assert.ok(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      KEYS.publicKey,
      bytes,
      new TextEncoder().encode(`${head}.${claims}`),
    ),
    "the secret verifies with the key's public half",
  );
  assert.ok(
    !JSON.stringify([r.logs, r.console]).includes("code-1") &&
      !JSON.stringify([r.logs, r.console]).includes("PRIVATE"),
    "neither the code nor the key is logged or printed",
  );
});

Deno.test("an account with no Apple identity is deleted with no call to Apple, against one with it", async () => {
  const none = await run({
    ...revoking(),
    identities: [{ provider: "google", identity_data: { sub: "g-1" } }],
  });
  assert.equal(none.status, 204);
  assert.deepEqual(none.deleted, [ADA]);
  assert.deepEqual(sentToApple(none), []);
  assert.deepEqual(none.logs.map((entry) => entry.apple), ["none"]);

  const control = await run(revoking());
  assert.equal(sentToApple(control).length, 2);
});

Deno.test("an Apple refusal of the code or of the revocation does not stop the deletion, and is logged, against an accepted one", async () => {
  const code = await run({ ...revoking(), apple: { token: 400 } });
  assert.equal(code.status, 204);
  assert.deepEqual(code.deleted, [ADA]);
  assert.deepEqual(code.logs.map((entry) => entry.apple), ["refused"]);
  assert.deepEqual(sentToApple(code).map((call) => call.path), ["/auth/token"]);

  const revoke = await run({ ...revoking(), apple: { revoke: 400 } });
  assert.equal(revoke.status, 204);
  assert.deepEqual(revoke.deleted, [ADA]);
  assert.deepEqual(revoke.logs.map((entry) => entry.apple), ["refused"]);

  const offline = await run({ ...revoking(), apple: { token: "offline" } });
  assert.equal(offline.status, 204);
  assert.deepEqual(offline.logs.map((entry) => entry.apple), ["unreachable"]);

  const control = await run(revoking());
  assert.deepEqual(control.logs.map((entry) => entry.apple), ["revoked"]);
});

Deno.test("a code of another Apple account is not revoked and the deletion goes on, against the user's own", async () => {
  const other = await run({ ...revoking(), apple: { sub: "someone.else" } });
  assert.equal(other.status, 204);
  assert.deepEqual(other.deleted, [ADA]);
  assert.deepEqual(other.logs.map((entry) => entry.apple), ["mismatch"]);
  assert.deepEqual(sentToApple(other).map((call) => call.path), [
    "/auth/token",
  ]);

  const own = await run(revoking());
  assert.deepEqual(sentToApple(own).map((call) => call.path), [
    "/auth/token",
    "/auth/revoke",
  ]);
});

Deno.test("without a code, or without the Apple secrets, an Apple account is deleted with no call to Apple, against a request with both", async () => {
  for (
    const [options, apple] of [
      [{ ...revoking({}) }, "no_code"],
      [{ ...revoking("not an object") }, "no_code"],
      [{ ...revoking({ apple_authorization_code: 5 }) }, "no_code"],
      [{ ...revoking(), body: "not json" }, "no_code"],
      [{ ...revoking(), body: undefined }, "no_code"],
      [{ ...revoking(), env: {} }, "not_configured"],
      [
        { ...revoking(), env: { ...APPLE_ENV, APPLE_KEY_ID: "" } },
        "not_configured",
      ],
      [
        {
          ...revoking(),
          env: { ...APPLE_ENV, APPLE_PRIVATE_KEY: "not a key" },
        },
        "not_configured",
      ],
    ] as const
  ) {
    const r = await run(options);
    assert.equal(r.status, 204, apple);
    assert.deepEqual(r.deleted, [ADA], apple);
    assert.deepEqual(sentToApple(r), [], apple);
    assert.deepEqual(r.logs.map((entry) => entry.apple), [apple]);
  }
  const control = await run(revoking());
  assert.equal(sentToApple(control).length, 2);
});
