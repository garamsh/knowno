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
  calls: { url: string; method: string; headers: Headers }[];
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
    fake.calls.push({ url, method, headers });
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
  } = {},
): Promise<Run> {
  const fake: Fake = {
    admin: options.admin ?? 200,
    lookup: options.lookup ?? null,
    storage: options.storage ?? 200,
    objects: new Set(options.objects ?? []),
    photos: new Set(options.photos ?? []),
    calls: [],
  };
  const env = { ...ENV, ...options.env };
  const logs: LogEntry[] = [];
  const handler = createHandler({
    config: readConfig((name) => env[name]),
    fetch: fakeFetch(fake),
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
    assert.deepEqual(r.logs, [{ user_id: ADA, outcome: "delete_failed" }]);
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
  assert.deepEqual(deleted.logs, [{ user_id: ADA, outcome: "deleted" }]);
  const refused = await run({ authorization: "Bearer anon-key" });
  assert.deepEqual(refused.logs, [{
    user_id: null,
    outcome: "unauthenticated",
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
  assert.deepEqual(logs, [{ user_id: null, outcome: "internal" }]);
});
