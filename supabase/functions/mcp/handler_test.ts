// The MCP server end to end, with Supabase Auth and PostgREST replaced by an in-memory fake that
// applies row-level security's owner rule. The suite runs without write or network permission.
import assert from "node:assert/strict";
import validity from "../../fixtures/card-frame/validity.json" with {
  type: "json",
};
import {
  cardFormSkills,
  FORMS,
  formUri,
  GUIDE_URI,
} from "../_shared/card_forms.ts";
import { SEED } from "../_shared/card_forms_seed.ts";
import type { IdSource } from "../_shared/cards.ts";
import { readConfig } from "./config.ts";
import { createHandler, type LogEntry } from "./handler.ts";

const SUPABASE_URL = "http://kong:8000";
const ANON_KEY = "anon-key";
const ADA = "00000000-0000-4000-8000-00000000000a";
const GRACE = "00000000-0000-4000-8000-00000000000b";
const ADA_DECK = "00000000-0000-7000-8000-0000000000d1";
const ADA_OTHER_DECK = "00000000-0000-7000-8000-0000000000d2";
const ADA_DELETED_DECK = "00000000-0000-7000-8000-0000000000d3";
const GRACE_PUBLIC_DECK = "00000000-0000-7000-8000-0000000000e1";

/** A JWT whose payload holds [claims]; the fake Auth server decides whether it is valid. */
function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(
      /\//g,
      "_",
    );
  return `${part({ alg: "ES256" })}.${part(claims)}.signature`;
}

const ADA_TOKEN = jwt({ sub: ADA, client_id: "claude", aud: "authenticated" });
const GRACE_TOKEN = jwt({
  sub: GRACE,
  client_id: "chatgpt",
  aud: "authenticated",
});
/** A session the web or the phone holds: Auth accepts it, and it carries no client_id. */
const ADA_SESSION = jwt({ sub: ADA, aud: "authenticated" });
const EXPIRED = jwt({ sub: ADA, client_id: "claude", exp: 1 });

type Row = Record<string, unknown>;

type Fake = {
  decks: Row[];
  cards: Row[];
  /** Study state by card, which no tool writes. */
  card_states: Row[];
  /** The last revision the server's trigger drew. */
  revision: number;
  media: Row[];
  /** The bucket's files by path, as the Storage API received them. */
  objects: Map<string, { bytes: Uint8Array; type: string | null }>;
  /**
   * "refusing" makes the Storage API answer every upload and deletion 400, and "keeping" every
   * deletion alone.
   */
  storage: "up" | "refusing" | "keeping";
  /** The replies of the internet, by URL. */
  web: Record<string, () => Response>;
  /** Each host's addresses; a host absent here has one public address. */
  dns: Record<string, string[]>;
  /**
   * "offline" makes every request to PostgREST fail to arrive, and "refusing card writes" answers
   * every insert into or update of `cards` 500.
   */
  rest: "up" | "offline" | "refusing card writes";
  calls: { url: string; method: string; headers: Headers }[];
  /** What `card_form_skills` answers: one served version of each form. */
  skills: Row[];
  /** What `card_markup_enabled` answers: whether the markup's forms are written (ADR 0216). */
  markup: boolean;
  /** The plan `my_plan` answers for the caller, "broken" an answer without one, "down" a 500. */
  plan: "free" | "pro" | "max" | "broken" | "down";
};

function block(type: string, payload: Row) {
  return { type, v: 1, id: crypto.randomUUID(), payload };
}

function card(
  id: string,
  deck: string,
  user: string,
  front: unknown[],
  back: unknown[],
  extra = {},
) {
  return {
    id,
    deck_id: deck,
    user_id: user,
    front,
    back,
    card_key: String(
      (front[0] as { payload: { text?: string } }).payload.text ?? "",
    ).toLowerCase(),
    deleted_at: null,
    created_at: `2026-10-0${id.slice(-1)}T00:00:00.000Z`,
    updated_at: `2026-10-0${id.slice(-1)}T00:00:00.000Z`,
    ...extra,
  };
}

function seed(): Fake {
  return {
    rest: "up",
    calls: [],
    markup: false,
    plan: "pro",
    skills: FORMS.map((form, index) => ({
      form,
      version_id: index + 1,
      summary: SEED[form].summary,
      text: SEED[form].text,
    })),
    revision: 100,
    card_states: [{
      card_id: "00000000-0000-7000-8000-000000000c01",
      user_id: ADA,
      stability: 4.5,
      due: "2026-11-05T00:00:00.000Z",
    }],
    media: [],
    objects: new Map(),
    storage: "up",
    web: {},
    dns: {},
    decks: [
      {
        id: ADA_DECK,
        user_id: ADA,
        name: "영단어",
        visibility: "private",
        deleted_at: null,
        created_at: "2026-10-01",
      },
      {
        id: ADA_OTHER_DECK,
        user_id: ADA,
        name: "Biology",
        visibility: "private",
        deleted_at: null,
        created_at: "2026-10-02",
      },
      {
        id: ADA_DELETED_DECK,
        user_id: ADA,
        name: "Gone",
        visibility: "private",
        deleted_at: "2026-10-03",
        created_at: "2026-10-03",
      },
      {
        id: GRACE_PUBLIC_DECK,
        user_id: GRACE,
        name: "Grace's",
        visibility: "public",
        deleted_at: null,
        created_at: "2026-10-01",
      },
    ],
    cards: [
      card("00000000-0000-7000-8000-000000000c01", ADA_DECK, ADA, [
        block("text", { text: "apple" }),
      ], [
        block("senses", {
          senses: [{
            labels: [{ kind: "part_of_speech", category: "noun", text: "명" }],
            meaning: "사과",
            examples: ["An apple a day."],
          }],
        }),
      ]),
      card("00000000-0000-7000-8000-000000000c02", ADA_DECK, ADA, [
        block("text", { text: "Banana" }),
      ], [
        block("text", { text: "바나나" }),
      ]),
      card(
        "00000000-0000-7000-8000-000000000c03",
        ADA_DECK,
        ADA,
        [block("cloze", { text: "The ___ is red", answers: ["cherry"] })],
        [block("text", { text: "stale back" })],
        { card_key: "the cherry is red" },
      ),
      card(
        "00000000-0000-7000-8000-000000000c04",
        ADA_DECK,
        ADA,
        [block("text", { text: "deleted" })],
        [],
        {
          deleted_at: "2026-10-05",
        },
      ),
      card("00000000-0000-7000-8000-000000000c05", ADA_OTHER_DECK, ADA, [
        block("text", { text: "cell" }),
      ], [
        block("text", { text: "세포 apple" }),
      ]),
      card("00000000-0000-7000-8000-000000000c06", GRACE_PUBLIC_DECK, GRACE, [
        block("text", { text: "apple pie" }),
      ], [
        block("text", { text: "grace's" }),
      ]),
    ],
  };
}

/** The user a token signs in, as Supabase Auth answers `/auth/v1/user`. */
function authUser(token: string | undefined): string | null {
  if (token === ADA_TOKEN || token === ADA_SESSION) return ADA;
  if (token === GRACE_TOKEN) return GRACE;
  return null;
}

/** A filter PostgREST reads from the query: `column=eq.value`, `column=in.(a,b)` and `column=is.null`. */
function matches(row: Row, params: URLSearchParams, prefix = ""): boolean {
  for (const [key, value] of params) {
    if (
      !key.startsWith(prefix) ||
      ["select", "order", "limit", "offset"].includes(key)
    ) continue;
    const column = key.slice(prefix.length);
    if (column.includes(".")) continue;
    if (value === "is.null" && row[column] !== null) return false;
    if (value.startsWith("eq.") && String(row[column]) !== value.slice(3)) {
      return false;
    }
    if (
      value.startsWith("in.(") &&
      !value.slice(4, -1).split(",").includes(String(row[column]))
    ) return false;
    // Postgres compares a null as unknown, so `lt` drops it.
    if (
      value.startsWith("lt.") &&
      !(typeof row[column] === "string" && row[column] < value.slice(3))
    ) return false;
  }
  return true;
}

/** A client's write to a public note's text hides it until it is checked again (ADR 0238). */
function checkAgain(fake: Fake, deckIds: unknown[]) {
  for (const deck of fake.decks) {
    if (deck.publication === "public" && deckIds.includes(deck.id)) {
      deck.publication = "checking";
    }
  }
}

/** PostgREST over [fake], with row-level security's rules for [user]. */
function rest(
  fake: Fake,
  url: URL,
  method: string,
  headers: Headers,
  body: unknown,
) {
  const user = authUser(headers.get("Authorization")?.slice(7));
  if (user === null || headers.get("apikey") !== ANON_KEY) {
    return Response.json({ code: "PGRST301" }, { status: 401 });
  }
  const table = url.pathname.split("/").at(-1);
  if (url.pathname.endsWith("/rpc/my_plan") && method === "POST") {
    if (fake.plan === "down") return Response.json({}, { status: 500 });
    return Response.json([fake.plan === "broken" ? {} : { plan: fake.plan }]);
  }
  if (url.pathname.endsWith("/rpc/card_markup_enabled") && method === "POST") {
    return Response.json(fake.markup);
  }
  if (url.pathname.endsWith("/rpc/card_form_skills") && method === "POST") {
    return Response.json(fake.skills);
  }
  const rows = table === "decks"
    ? fake.decks
    : table === "cards"
    ? fake.cards
    : table === "media"
    ? fake.media
    : table === "card_states"
    ? fake.card_states
    : null;
  if (rows === null) return Response.json({}, { status: 404 });
  if (
    fake.rest === "refusing card writes" && table === "cards" &&
    (method === "POST" || method === "PATCH")
  ) return Response.json({ code: "XX000" }, { status: 500 });
  if (method === "POST") {
    const inserted = body as Row[];
    for (const row of inserted) {
      // The insert policy, and the composite foreign key from a card to its owner's deck.
      if (row.user_id !== user) {
        return Response.json({ code: "42501" }, { status: 403 });
      }
      if (
        table === "cards" &&
        !fake.decks.some((deck) =>
          deck.id === row.deck_id && deck.user_id === user
        )
      ) return Response.json({ code: "23503" }, { status: 409 });
    }
    rows.push(...inserted.map((row) => ({ deleted_at: null, ...row })));
    if (table === "cards") checkAgain(fake, inserted.map((row) => row.deck_id));
    return new Response(null, { status: 201 });
  }
  if (method === "PATCH") {
    // The update policy: the caller's own rows alone, each given the trigger's next revision.
    const changed = rows.filter((row) =>
      row.user_id === user && matches(row, url.searchParams)
    );
    for (const row of changed) {
      Object.assign(row, body as Row, { revision: ++fake.revision });
    }
    checkAgain(
      fake,
      changed.map((row) => table === "decks" ? row.id : row.deck_id),
    );
    return Response.json(changed.map((row) => ({ id: row.id })));
  }
  if (method === "DELETE") {
    const params = url.searchParams;
    fake.media = fake.media.filter((row) =>
      row.user_id !== user || !matches(row, params)
    );
    return new Response(null, { status: 204 });
  }
  // The select policy: the user's own rows, and a visibly public deck and its live cards.
  const visible = rows.filter((row) =>
    row.user_id === user ||
    (table === "decks"
      ? row.visibility === "public" && row.deleted_at === null
      : fake.decks.some((deck) =>
        deck.id === row.deck_id && deck.visibility === "public" &&
        deck.deleted_at === null
      ))
  );
  const params = url.searchParams;
  let found = visible.filter((row) => matches(row, params));
  // `order=created_at.asc,id.asc`, the order every listing names.
  found.sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at)) ||
    String(a.id).localeCompare(String(b.id))
  );
  const total = found.length;
  const offset = Number(params.get("offset") ?? 0);
  const limit = Number(params.get("limit") ?? 1000);
  found = found.slice(offset, offset + limit);
  const select = params.get("select") ?? "";
  const shaped = found.map((row) => {
    const out: Row = {};
    for (const column of select.split(",")) {
      if (column === "cards(count)") {
        out.cards = [{
          count: fake.cards.filter((c) =>
            c.deck_id === row.id && matches(c, params, "cards.")
          )
            .length,
        }];
      } else out[column] = row[column];
    }
    return out;
  });
  const range = headers.get("Prefer") === "count=exact"
    ? { "Content-Range": `${offset}-${offset + shaped.length - 1}/${total}` }
    : undefined;
  return Response.json(shaped, { headers: range });
}

function fakeFetch(fake: Fake): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    fake.calls.push({ url: url.href, method, headers });
    if (url.href === `${SUPABASE_URL}/auth/v1/user`) {
      const user = authUser(headers.get("Authorization")?.slice(7));
      return user === null
        ? Response.json({ code: 403, error_code: "bad_jwt" }, { status: 403 })
        : Response.json({ id: user, role: "authenticated" });
    }
    if (url.href.startsWith(`${SUPABASE_URL}/rest/v1/`)) {
      if (fake.rest === "offline") throw new TypeError("error sending request");
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body)
        : undefined;
      return await rest(fake, url, method, headers, body);
    }
    if (
      url.href === `${SUPABASE_URL}/storage/v1/object/media` &&
      method === "DELETE"
    ) {
      // The bucket's delete policy: files in the caller's own folder alone.
      const user = authUser(headers.get("Authorization")?.slice(7));
      if (fake.storage !== "up" || user === null) {
        return Response.json({ error: "refused" }, { status: 400 });
      }
      const { prefixes } = JSON.parse(String(init?.body)) as {
        prefixes: string[];
      };
      const removed = prefixes.filter((path) =>
        path.startsWith(`${user}/`) && fake.objects.delete(path)
      );
      return Response.json(removed.map((name) => ({ name })));
    }
    const object = url.href.match(/\/storage\/v1\/object\/media\/(.+)$/);
    if (object !== null && url.href.startsWith(SUPABASE_URL)) {
      const path = object[1]!;
      const owned = fake.media.some((row) =>
        `${row.user_id}/${row.id}` === path &&
        row.user_id === authUser(headers.get("Authorization")?.slice(7))
      );
      if (fake.storage === "refusing" || !owned) {
        return Response.json({ error: "refused" }, { status: 400 });
      }
      fake.objects.set(path, {
        bytes: init?.body as Uint8Array,
        type: headers.get("Content-Type"),
      });
      return Response.json({ Key: path });
    }
    const reply = fake.web[url.href];
    if (reply !== undefined) return reply();
    throw new Error(`unexpected request to ${url.href}`);
  };
}

type Run = {
  status: number;
  headers: Headers;
  json: unknown;
  logs: LogEntry[];
  fake: Fake;
};

let clock = Date.UTC(2026, 9, 29);

async function send(
  options: {
    token?: string | null;
    method?: string;
    path?: string;
    body?: unknown;
    headers?: Record<string, string>;
    fake?: Fake;
    ids?: IdSource;
    supabaseUrl?: string;
    publicUrl?: string;
  } = {},
): Promise<Run> {
  const fake = options.fake ?? seed();
  const logs: LogEntry[] = [];
  const handler = createHandler({
    config: readConfig((name) =>
      ({
        SUPABASE_URL: options.supabaseUrl ?? SUPABASE_URL,
        SUPABASE_ANON_KEY: ANON_KEY,
        MCP_PUBLIC_URL: options.publicUrl,
      })[name]
    ),
    fetch: fakeFetch(fake),
    log: (entry) => logs.push(entry),
    ...(options.ids ?? {
      now: () => clock++,
      random: (bytes: number) => crypto.getRandomValues(new Uint8Array(bytes)),
    }),
    resolve: (host) => Promise.resolve(fake.dns[host] ?? ["93.184.216.34"]),
    timeout: () => new AbortController().signal,
    skills: cardFormSkills(() => clock),
  });
  const headers = new Headers({
    "X-Forwarded-Host": "127.0.0.1:54321",
    "Content-Type": "application/json",
    ...options.headers,
  });
  const token = options.token === undefined ? ADA_TOKEN : options.token;
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  const method = options.method ?? "POST";
  const response = await handler(
    new Request(`http://localhost:9000${options.path ?? "/mcp"}`, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    json: text === "" ? null : JSON.parse(text),
    logs,
    fake,
  };
}

/** Calls the tool [name] and returns its result object. */
async function call(
  name: string,
  args: unknown,
  fake = seed(),
  token: string = ADA_TOKEN,
  ids?: IdSource,
) {
  const run = await send({
    token,
    fake,
    ids,
    body: {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name, arguments: args },
    },
  });
  assert.equal(run.status, 200);
  const { result } = run.json as {
    result: {
      isError?: boolean;
      structuredContent?: Row;
      content: { text: string }[];
    };
  };
  return { result, fake, logs: run.logs };
}

const METADATA = `${SUPABASE_URL}/functions/v1/mcp/oauth-protected-resource`;
/** A hosted project's `SUPABASE_URL`. */
const PROJECT = "https://abcdefghijklmnopqrst.supabase.co";

Deno.test("a request without a token is answered 401 with the resource metadata's address, and one with a connector's token is served", async () => {
  const missing = await send({
    token: null,
    body: { jsonrpc: "2.0", id: 1, method: "ping" },
  });
  assert.equal(missing.status, 401);
  assert.equal(
    missing.headers.get("WWW-Authenticate"),
    `Bearer resource_metadata="${METADATA}"`,
  );
  const served = await send({
    body: { jsonrpc: "2.0", id: 1, method: "ping" },
  });
  assert.equal(served.status, 200);
  assert.deepEqual(served.json, { jsonrpc: "2.0", id: 1, result: {} });
});

Deno.test("an expired token is answered 401 with invalid_token and the resource metadata", async () => {
  const run = await send({
    token: EXPIRED,
    body: { jsonrpc: "2.0", id: 1, method: "ping" },
  });
  assert.equal(run.status, 401);
  const challenge = run.headers.get("WWW-Authenticate") ?? "";
  assert.match(
    challenge,
    /^Bearer error="invalid_token", error_description="[^"]+"/,
  );
  assert.match(challenge, new RegExp(`resource_metadata="${METADATA}"$`));
  assert.equal(run.fake.calls[0]?.url, `${SUPABASE_URL}/auth/v1/user`);
  assert.equal(run.fake.calls[0]?.headers.get("apikey"), ANON_KEY);
});

Deno.test("a session Supabase Auth accepts but the OAuth server did not issue is refused before Auth is asked", async () => {
  const run = await send({
    token: ADA_SESSION,
    body: { jsonrpc: "2.0", id: 1, method: "ping" },
  });
  assert.equal(run.status, 401);
  assert.equal(run.fake.calls.length, 0);
});

Deno.test("a local stack's metadata names its own SUPABASE_URL as the resource's origin and Auth's issuer", async () => {
  const run = await send({
    token: null,
    method: "GET",
    path: "/mcp/oauth-protected-resource",
  });
  assert.equal(run.status, 200);
  assert.deepEqual(run.json, {
    resource: "http://kong:8000/functions/v1/mcp",
    authorization_servers: ["http://kong:8000/auth/v1"],
    bearer_methods_supported: ["header"],
    resource_name: "knowno",
  });
});

const PUBLIC_URL = "https://api.knowno.app/functions/v1/mcp";

Deno.test("with MCP_PUBLIC_URL set the 401 and the metadata name it as the resource, the authorization server staying Auth's issuer", async () => {
  const challenge = await send({
    token: null,
    publicUrl: PUBLIC_URL,
    supabaseUrl: PROJECT,
    body: { jsonrpc: "2.0", id: 1, method: "ping" },
  });
  assert.equal(challenge.status, 401);
  assert.equal(
    challenge.headers.get("WWW-Authenticate"),
    'Bearer resource_metadata="https://api.knowno.app/functions/v1/mcp/oauth-protected-resource"',
  );
  const metadata = await send({
    token: null,
    publicUrl: PUBLIC_URL,
    supabaseUrl: PROJECT,
    method: "GET",
    path: "/mcp/oauth-protected-resource",
  });
  assert.deepEqual(metadata.json, {
    resource: PUBLIC_URL,
    authorization_servers: [`${PROJECT}/auth/v1`],
    bearer_methods_supported: ["header"],
    resource_name: "knowno",
  });
});

Deno.test("without MCP_PUBLIC_URL the resource is SUPABASE_URL's origin whatever host the request names", async () => {
  for (
    const host of ["api.knowno.app", "evil.example", "127.0.0.1:54321"]
  ) {
    const metadata = await send({
      token: null,
      headers: { "X-Forwarded-Host": host },
      supabaseUrl: PROJECT,
      method: "GET",
      path: "/mcp/oauth-protected-resource",
    });
    assert.equal(
      (metadata.json as Row).resource,
      `${PROJECT}/functions/v1/mcp`,
      host,
    );
    const challenge = await send({
      token: null,
      headers: { "X-Forwarded-Host": host },
      supabaseUrl: PROJECT,
    });
    assert.equal(
      challenge.headers.get("WWW-Authenticate"),
      `Bearer resource_metadata="${PROJECT}/functions/v1/mcp/oauth-protected-resource"`,
      host,
    );
  }
});

Deno.test("an MCP_PUBLIC_URL that is not an https URL ending in /functions/v1/mcp leaves the function unconfigured, as a valid one configures it", async () => {
  for (
    const publicUrl of [
      "not a url",
      "http://api.knowno.app/functions/v1/mcp",
      "https://api.knowno.app",
      "https://api.knowno.app/functions/v1/mcp/",
      "https://api.knowno.app/functions/v1/mcp?x=1",
    ]
  ) {
    const run = await send({
      token: null,
      publicUrl,
      supabaseUrl: PROJECT,
      method: "GET",
      path: "/mcp/oauth-protected-resource",
    });
    assert.equal(run.status, 503, publicUrl);
  }
  const configured = await send({
    token: null,
    publicUrl: PUBLIC_URL,
    supabaseUrl: PROJECT,
    method: "GET",
    path: "/mcp/oauth-protected-resource",
  });
  assert.equal(configured.status, 200);
});

Deno.test("a SUPABASE_URL that is not an http(s) URL leaves the function unconfigured, as a valid one configures it", async () => {
  for (
    const supabaseUrl of ["not a url", "ftp://abcdefghijklmnopqrst.supabase.co"]
  ) {
    const run = await send({
      token: null,
      supabaseUrl,
      method: "GET",
      path: "/mcp/oauth-protected-resource",
    });
    assert.equal(run.status, 503, supabaseUrl);
  }
  const configured = await send({
    token: null,
    supabaseUrl: PROJECT,
    method: "GET",
    path: "/mcp/oauth-protected-resource",
  });
  assert.equal(configured.status, 200);
});

Deno.test("initialize names the server knowno", async () => {
  const run = await send({
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    },
  });
  const result = (run.json as { result: Row }).result;
  assert.deepEqual(result.serverInfo, {
    name: "knowno",
    title: "knowno",
    version: "1",
  });
  assert.match(String(result.instructions), /^knowno is a flashcard app\./);
});

Deno.test("initialize answers the offered version when served and the newest otherwise, with the tools capability", async () => {
  const offered = await send({
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    },
  });
  const result = (offered.json as { result: Row }).result;
  assert.equal(result.protocolVersion, "2025-06-18");
  assert.deepEqual(result.capabilities, {
    tools: { listChanged: false },
    resources: { listChanged: false },
  });
  assert.equal(offered.headers.get("Mcp-Session-Id"), null);
  const unknown = await send({
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    },
  });
  assert.equal(
    (unknown.json as { result: Row }).result.protocolVersion,
    "2025-11-25",
  );
});

Deno.test("a notification is accepted with 202 and no body; a GET is 405", async () => {
  const notification = await send({
    body: { jsonrpc: "2.0", method: "notifications/initialized" },
  });
  assert.equal(notification.status, 202);
  assert.equal(notification.json, null);
  const get = await send({ method: "GET" });
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("Allow"), "POST");
});

Deno.test("a request carrying an Origin is refused with 403, and one without is served", async () => {
  const body = { jsonrpc: "2.0", id: 1, method: "ping" };
  assert.equal(
    (await send({ body, headers: { Origin: "https://evil.example" } })).status,
    403,
  );
  assert.equal((await send({ body })).status, 200);
});

Deno.test("a protocol version header this server does not speak is refused with 400, and a served one is answered", async () => {
  const body = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  const modern = await send({
    body,
    headers: { "MCP-Protocol-Version": "2026-07-28" },
  });
  assert.equal(modern.status, 400);
  assert.equal((modern.json as { error: { code: number } }).error.code, -32600);
  const served = await send({
    body,
    headers: { "MCP-Protocol-Version": "2025-11-25" },
  });
  assert.equal(served.status, 200);
  const tools =
    (served.json as { result: { tools: { name: string }[] } }).result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), [
    "list_decks",
    "list_cards",
    "search_cards",
    "create_deck",
    "add_cards",
    "update_cards",
    "delete_cards",
    "update_deck",
    "delete_deck",
  ]);
});

Deno.test("list_decks lists the caller's live decks with their live card counts, never another user's public deck", async () => {
  const { result, fake } = await call("list_decks", {});
  assert.deepEqual(result.structuredContent, {
    decks: [
      { id: ADA_DECK, name: "영단어", card_count: 3 },
      { id: ADA_OTHER_DECK, name: "Biology", card_count: 1 },
    ],
  });
  assert.deepEqual(
    JSON.parse(result.content[0]!.text),
    result.structuredContent,
  );
  assert.ok(
    fake.calls.every((c) =>
      !c.headers.get("Authorization")?.includes(ANON_KEY)
    ),
  );
});

Deno.test("list_cards pages a deck's live cards as blocks, a card of two sides read as its 칸", async () => {
  const first = await call("list_cards", { deck_id: ADA_DECK, limit: 2 });
  assert.deepEqual(first.result.structuredContent, {
    deck: { id: ADA_DECK, name: "영단어" },
    total: 3,
    cards: [
      {
        id: "00000000-0000-7000-8000-000000000c01",
        blocks: [{
          type: "senses",
          term: "apple",
          ask: "term",
          senses: [{
            labels: ["명"],
            meaning: "사과",
            examples: ["An apple a day."],
          }],
        }],
      },
      {
        id: "00000000-0000-7000-8000-000000000c02",
        blocks: [{ type: "text", front: "Banana", back: "바나나" }],
      },
    ],
    next_offset: 2,
  });
  const last = await call("list_cards", {
    deck_id: ADA_DECK,
    limit: 2,
    offset: 2,
  });
  assert.deepEqual(last.result.structuredContent?.cards, [
    {
      id: "00000000-0000-7000-8000-000000000c03",
      blocks: [
        { type: "cloze", text: "The ___ is red", answers: ["cherry"] },
        { type: "text", front: "", back: "stale back" },
      ],
    },
  ]);
  assert.equal(last.result.structuredContent?.next_offset, null);
});

Deno.test("list_cards says a card that does not parse is unreadable, and lists the rest", async () => {
  const fake = seed();
  fake.cards[1]!.front = [{ type: "cloze", v: 1, payload: { text: 7 } }];
  const { result } = await call("list_cards", { deck_id: ADA_DECK }, fake);
  const cards = result.structuredContent?.cards as Row[];
  assert.deepEqual(cards[1]!.blocks, [{
    type: "unknown",
    stored_type: "unreadable",
  }]);
  assert.notDeepEqual(cards[0]!.blocks, cards[1]!.blocks);
});

Deno.test("list_cards refuses another user's public deck, which row-level security lets the caller read, and serves the caller's own", async () => {
  const foreign = await call("list_cards", { deck_id: GRACE_PUBLIC_DECK });
  assert.equal(foreign.result.isError, true);
  assert.match(foreign.result.content[0]!.text, /list_decks/);
  const own = await call("list_cards", { deck_id: ADA_OTHER_DECK });
  assert.equal(own.result.isError, undefined);
});

Deno.test("search_cards matches every 칸 revealed ignoring case across the caller's decks, with its blocks", async () => {
  const apple = await call("search_cards", { query: "APPLE" });
  const cards = apple.result.structuredContent?.cards as Row[];
  assert.deepEqual(cards.map((c) => c.id), [
    "00000000-0000-7000-8000-000000000c01",
    "00000000-0000-7000-8000-000000000c05",
  ]);
  assert.deepEqual(cards[1]?.deck, { id: ADA_OTHER_DECK, name: "Biology" });
  assert.deepEqual(cards[1]?.blocks, [
    { type: "text", front: "cell", back: "세포 apple" },
  ]);
  const back = await call("search_cards", { query: "stale back" });
  assert.equal((back.result.structuredContent?.cards as Row[]).length, 1);
  const answer = await call("search_cards", { query: "cherry" });
  assert.equal((answer.result.structuredContent?.cards as Row[]).length, 1);
  const absent = await call("search_cards", { query: "no such text" });
  assert.deepEqual(absent.result.structuredContent, {
    cards: [],
    truncated: false,
  });
  const limited = await call("search_cards", { query: "a", limit: 1 });
  assert.equal(limited.result.structuredContent?.truncated, true);
});

Deno.test("create_deck stores a private deck of the caller's under a version 7 id and returns it", async () => {
  const { result, fake } = await call("create_deck", { name: "  Spanish  " });
  const deck = result.structuredContent?.deck as { id: string; name: string };
  assert.equal(deck.name, "Spanish");
  assert.match(
    deck.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  const stored = fake.decks.find((row) => row.id === deck.id);
  assert.equal(stored?.user_id, ADA);
  assert.equal(stored?.visibility, "private");
  assert.equal(stored?.created_at, stored?.updated_at);
  const blank = await call("create_deck", { name: "   " });
  assert.equal(blank.result.isError, true);
});

Deno.test("add_cards stores the plain form as free v2: one 글, or a 단어 with labels or examples, and the card key", async () => {
  const { result, fake } = await call("add_cards", {
    deck_id: ADA_DECK,
    cards: [
      {
        front: "  Run  ",
        back: "달리다",
        labels: ["동", "informal"],
        examples: ["I run."],
      },
      { front: "cat", back: "고양이" },
    ],
  });
  const added = result.structuredContent?.added as {
    index: number;
    id: string;
  }[];
  assert.deepEqual(added.map((a) => a.index), [0, 1]);
  const run = fake.cards.find((row) => row.id === added[0]!.id)!;
  assert.deepEqual(run.back, []);
  const [{ id: wordId, ...word }] = run.front as Row[];
  assert.match(String(wordId), /^[0-9a-f-]{14}7/);
  assert.deepEqual(word, {
    type: "senses",
    v: 2,
    payload: {
      term: "Run",
      ask: "term",
      senses: [{
        labels: [
          { kind: "part_of_speech", category: "verb", text: "동" },
          { kind: "other", category: null, text: "informal" },
        ],
        meaning: "달리다",
        examples: ["I run."],
      }],
    },
  });
  assert.equal(run.card_key, "run");
  assert.equal(run.template, "free");
  assert.equal(run.template_version, 2);
  assert.equal(run.source, "import");
  assert.equal(run.user_id, ADA);
  assert.equal(run.deck_id, ADA_DECK);
  assert.equal(run.created_at, run.updated_at);
  assert.equal(run.revision, undefined);
  const cat = fake.cards.find((row) => row.id === added[1]!.id)!;
  const [{ id: _c, ...glue }] = cat.front as Row[];
  assert.deepEqual(glue, {
    type: "text",
    v: 2,
    payload: { front: "cat", back: "고양이" },
  });
  assert.deepEqual(cat.back, []);
});

/** [card]'s stored blocks without their ids. */
const storedBlocks = (card: Row) =>
  (card.front as Row[]).map(({ id: _id, ...block }) => block);

Deno.test("add_cards stores each 칸 as the web's encodeCells writes it, a mixed card in order", async () => {
  const table = {
    type: "table",
    columns: ["Organ", "Job"],
    rows: [["Heart", "Pumps blood"]],
    blanks: [{ row: 0, column: 1 }],
    spans: [{ row: 0, column: 0, start: 0, end: 2 }],
  };
  const { result, fake } = await call("add_cards", {
    deck_id: ADA_DECK,
    cards: [
      {
        blocks: [
          { type: "text", front: "Organs" },
          table,
          { type: "text", back: "see p. 3" },
        ],
      },
      {
        blocks: [{
          type: "cloze",
          text: "The capital is ___.",
          answers: ["Paris"],
        }],
      },
      {
        blocks: [{
          type: "senses",
          term: "apple",
          ask: "meaning",
          senses: [{ labels: ["명"], meaning: "사과" }],
        }],
      },
    ],
  });
  assert.deepEqual(result.structuredContent?.refused, []);
  const [mixed, cloze, word] = (result.structuredContent?.added as Row[]).map(
    (a) => fake.cards.find((row) => row.id === a.id)!,
  );
  assert.deepEqual(storedBlocks(mixed!), [
    { type: "text", v: 2, payload: { front: "Organs", back: "" } },
    {
      type: "table",
      v: 2,
      payload: {
        columns: table.columns,
        rows: table.rows,
        blanks: table.blanks,
        spans: table.spans,
      },
    },
    { type: "text", v: 2, payload: { front: "", back: "see p. 3" } },
  ]);
  assert.equal(mixed!.card_key, "organs organ | job heart | pumps blood");
  assert.deepEqual(storedBlocks(cloze!), [{
    type: "cloze",
    v: 1,
    payload: { text: "The capital is ___.", answers: ["Paris"] },
  }]);
  assert.equal(cloze!.card_key, "the capital is paris.");
  assert.equal(cloze!.template_version, 2);
  assert.deepEqual(cloze!.back, []);
  assert.equal(word!.card_key, "[명] 사과");
});

Deno.test("add_cards refuses what the shared validity refuses, over the fixtures, and adds what it accepts", async () => {
  const toInput = (block: { type: string; payload: Row }) => {
    const { media: _m, width: _w, height: _h, ...payload } = block.payload;
    return {
      type: block.type,
      ...payload,
      ...(block.type === "image" && { url: PHOTO }),
    };
  };
  for (const { name, blocks, problem } of validity) {
    // A sound is not in the union; the frame's reader holds its fixtures in frame_test.ts.
    if (blocks.some(({ type }) => type === "audio")) continue;
    const fake = withPhoto();
    const { result } = await call("add_cards", {
      deck_id: ADA_OTHER_DECK,
      cards: [{ blocks: blocks.map(toInput) }],
    }, fake);
    const content = result.structuredContent!;
    assert.equal(
      (content.refused as Row[]).length,
      problem === null ? 0 : 1,
      name,
    );
    assert.equal(
      (content.added as Row[]).length,
      problem === null ? 1 : 0,
      name,
    );
  }
});

Deno.test("add_cards says how to fix each refused 칸, by its index, and adds the rest", async () => {
  const cards = [
    { blocks: [{ type: "cloze", text: "no blank", answers: ["x"] }] },
    {
      blocks: [{
        type: "table",
        columns: ["a"],
        rows: [["b"]],
        blanks: [{ row: 5, column: 0 }],
      }],
    },
    { blocks: [{ type: "text", front: "fine" }] },
    { blocks: [{ type: "text", back: "fine" }] },
    { blocks: [{ type: "text", front: "a", back: "b" }, { type: "audio" }] },
    { blocks: [{ type: "image", side: "front" }] },
    { blocks: [{ type: "image", url: PHOTO }] },
    {
      blocks: [{ type: "text", front: "a", back: "b" }],
      front: "c",
      back: "d",
    },
    { blocks: [] },
    "a card",
    { blocks: [{ type: "text", front: "x".repeat(2001), back: "b" }] },
    { blocks: [{ type: "text", front: "kept", back: "남김" }] },
  ];
  const fake = withPhoto();
  const { result } = await call(
    "add_cards",
    { deck_id: ADA_DECK, cards },
    fake,
  );
  const refused = result.structuredContent?.refused as {
    index: number;
    reason: string;
  }[];
  const reasons = Object.fromEntries(refused.map((r) => [r.index, r.reason]));
  assert.match(reasons[0]!, /^block 0: a cloze needs text with one ___/);
  assert.match(reasons[1]!, /^block 0: a table needs/);
  assert.match(reasons[2]!, /adds nothing at the reveal/);
  assert.match(reasons[3]!, /shows nothing before the reveal/);
  assert.match(reasons[4]!, /^block 1: type must be text, senses/);
  assert.match(reasons[5]!, /needs url/);
  assert.match(reasons[6]!, /holds side, front or back, exactly while/);
  assert.match(reasons[7]!, /not both/);
  assert.match(reasons[8]!, /1 to 100 blocks/);
  assert.match(reasons[9]!, /must be an object/);
  assert.match(reasons[10]!, /at most 2000 characters/);
  assert.equal(refused.length, 11);
  assert.deepEqual(
    (result.structuredContent?.added as Row[]).map((a) => a.index),
    [11],
  );
  assert.equal(fake.calls.filter((c) => c.url === PHOTO).length, 0);
});

const PHOTO = "https://cdn.example/heart.png";

/** The first bytes of a PNG of 640 by 480. */
function pngBytes(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([...new TextEncoder().encode("IHDR")], 12);
  new DataView(bytes.buffer).setUint32(16, 640);
  new DataView(bytes.buffer).setUint32(20, 480);
  return bytes;
}

/** A seed whose internet serves [PHOTO]. */
function withPhoto(): Fake {
  const fake = seed();
  fake.web[PHOTO] = () =>
    new Response(pngBytes(), { headers: { "Content-Type": "image/png" } });
  return fake;
}

Deno.test("add_cards stores a photo as the phone does: its row, its file under the caller's folder, its size in the block", async () => {
  const fake = withPhoto();
  const { result } = await call("add_cards", {
    deck_id: ADA_DECK,
    cards: [{
      blocks: [
        { type: "image", url: PHOTO, side: "front" },
        { type: "text", back: "A heart" },
      ],
    }, {
      blocks: [{
        type: "image",
        url: PHOTO,
        boxes: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4, answer: "Aorta" }],
      }],
    }],
  }, fake);
  assert.deepEqual(result.structuredContent?.refused, []);
  const [placed, boxed] = (result.structuredContent?.added as Row[]).map(
    (a) => fake.cards.find((row) => row.id === a.id)!,
  );
  const [image] = storedBlocks(placed!) as { v: number; payload: Row }[];
  const media = String(image!.payload.media);
  assert.deepEqual(image, {
    type: "image",
    v: 2,
    payload: { media, width: 640, height: 480, boxes: [], side: "front" },
  });
  assert.equal(placed!.card_key, media);
  const row = fake.media.find((r) => r.id === media)!;
  assert.deepEqual(
    [row.user_id, row.kind, row.mime_type, row.byte_size],
    [ADA, "image", "image/png", 33],
  );
  assert.match(String(row.sha256), /^[0-9a-f]{64}$/);
  const file = fake.objects.get(`${ADA}/${media}`)!;
  assert.equal(file.type, "image/png");
  assert.deepEqual(file.bytes, pngBytes());
  const [{ payload }] = storedBlocks(boxed!) as { payload: Row }[];
  const box = (payload.boxes as Row[])[0]!;
  assert.equal(typeof box.id, "string");
  assert.equal(box.answer, "Aorta");
  assert.equal("side" in payload, false);
  assert.equal(boxed!.card_key, `${payload.media} aorta`);
  const photoCall = fake.calls.find((c) => c.url === PHOTO)!;
  assert.equal(photoCall.headers.has("Authorization"), false);
});

Deno.test("list_cards reads a stored photo back in the union, by its media id", async () => {
  const fake = withPhoto();
  await call("add_cards", {
    deck_id: ADA_OTHER_DECK,
    cards: [{
      blocks: [
        { type: "text", front: "What is this?" },
        { type: "image", url: PHOTO, side: "back" },
      ],
    }],
  }, fake);
  const { result } = await call(
    "list_cards",
    { deck_id: ADA_OTHER_DECK },
    fake,
  );
  const cards = result.structuredContent?.cards as { blocks: Row[] }[];
  const { blocks } = cards.at(-1)!;
  const stored = fake.cards.at(-1)!.front as { id: string }[];
  assert.deepEqual(blocks[1], {
    type: "image",
    media: fake.media[0]!.id,
    width: 640,
    height: 480,
    boxes: [],
    side: "back",
    id: stored[1]!.id,
  });
});

Deno.test("a photo that cannot be fetched refuses its card alone, says why and stores nothing", async () => {
  const fake = withPhoto();
  fake.dns["inner.example"] = ["10.0.0.1"];
  const { result } = await call("add_cards", {
    deck_id: ADA_DECK,
    cards: [
      {
        blocks: [
          { type: "text", front: "private", back: "b" },
          { type: "image", url: "https://inner.example/a.png", side: "back" },
        ],
      },
      {
        blocks: [
          { type: "text", front: "public", back: "b" },
          { type: "image", url: PHOTO, side: "back" },
        ],
      },
    ],
  }, fake);
  const refused = result.structuredContent?.refused as Row[];
  assert.equal(refused.length, 1);
  assert.equal(refused[0]!.index, 0);
  assert.match(String(refused[0]!.reason), /public https address/);
  assert.deepEqual(
    (result.structuredContent?.added as Row[]).map((a) => a.index),
    [1],
  );
  assert.equal(fake.media.length, 1);
  assert.equal(fake.objects.size, 1);
});

Deno.test("a file Storage refuses takes its media row back and refuses the card, the call answering", async () => {
  const fake = withPhoto();
  fake.storage = "refusing";
  const { result } = await call("add_cards", {
    deck_id: ADA_DECK,
    cards: [
      { blocks: [{ type: "image", url: PHOTO, boxes: [BOX] }] },
      { blocks: [{ type: "text", front: "kept", back: "남김" }] },
    ],
  }, fake);
  assert.match(
    String((result.structuredContent?.refused as Row[])[0]!.reason),
    /could not be stored/,
  );
  assert.equal(fake.media.length, 0);
  assert.equal((result.structuredContent?.added as Row[]).length, 1);
});

const BOX = { x: 0, y: 0, w: 1, h: 1 };

Deno.test("a duplicate card's back photo is never fetched, and a card with a new front's is", async () => {
  const fake = withPhoto();
  const photoBack = { type: "image", url: PHOTO, side: "back" };
  const { result } = await call("add_cards", {
    deck_id: ADA_DECK,
    cards: [
      { blocks: [{ type: "text", front: "apple" }, photoBack] },
      { blocks: [{ type: "text", front: "new" }, photoBack] },
    ],
  }, fake);
  assert.equal((result.structuredContent?.skipped as Row[]).length, 1);
  assert.equal(fake.calls.filter((c) => c.url === PHOTO).length, 1);
  assert.equal(fake.media.length, 1);
});

Deno.test("add_cards fetches ten photos a call, an eleventh card refused with what to do", async () => {
  const fake = withPhoto();
  const cards = Array.from({ length: 11 }, () => ({
    blocks: [{ type: "image", url: PHOTO, boxes: [BOX] }],
  }));
  const { result } = await call(
    "add_cards",
    { deck_id: ADA_DECK, cards },
    fake,
  );
  assert.equal((result.structuredContent?.added as Row[]).length, 10);
  const refused = result.structuredContent?.refused as Row[];
  assert.equal(refused[0]!.index, 10);
  assert.match(String(refused[0]!.reason), /another call/);
});

/** Sends the JSON-RPC request [method] with [params] over [fake]. */
async function resource(method: string, params: unknown, fake = seed()) {
  const run = await send({
    fake,
    body: { jsonrpc: "2.0", id: 1, method, params },
  });
  return {
    ...run.json as {
      result?: Record<string, { uri?: string; text?: string }[]>;
      error?: { code: number; message: string };
    },
    logs: run.logs,
  };
}

/** The text of the resource at [uri] over [fake]. */
async function readResource(uri: string, fake = seed()): Promise<string> {
  const read = await resource("resources/read", { uri }, fake);
  return read.result!.contents![0]!.text!;
}

Deno.test("the card-form resources list the index, at the guide's old uri, and a guide for every form", async () => {
  const listed = (await resource("resources/list", {})).result!.resources!;
  assert.deepEqual(listed.map((one) => one.uri), [
    "knowno://guide/card-forms",
    ...FORMS.map((form) => `knowno://guide/card-forms/${form}`),
  ]);
});

Deno.test("the index names every form with its summary and its guide's uri, and each guide is its served skill's text", async () => {
  const index = await readResource(GUIDE_URI);
  for (const form of FORMS) {
    assert.ok(
      index.includes(
        `- **${form}** — ${SEED[form].summary} Guide: ${formUri(form)}`,
      ),
      form,
    );
    assert.equal(await readResource(formUri(form)), SEED[form].text, form);
  }
});

Deno.test("a skill version the database serves in place of the seed is what its resource reads", async () => {
  const fake = seed();
  fake.skills = fake.skills.map((row) =>
    row.form === "cloze"
      ? { ...row, version_id: 40, summary: "Edited summary.", text: "Edited." }
      : row
  );
  assert.equal(await readResource(formUri("cloze"), fake), "Edited.");
  assert.match(
    await readResource(GUIDE_URI, fake),
    /\*\*cloze\*\* — Edited summary\./,
  );
  // Control: the forms not edited read their seed.
  assert.equal(await readResource(formUri("table"), fake), SEED.table.text);
});

Deno.test("a resource read is refused at another uri before the database is asked, and answers -32603 while the database is down", async () => {
  const fake = seed();
  const other = await resource(
    "resources/read",
    { uri: "knowno://guide/card-forms/flip" },
    fake,
  );
  assert.equal(other.error?.code, -32002);
  assert.ok(!fake.calls.some((one) => one.url.includes("card_form_skills")));
  const down = seed();
  down.rest = "offline";
  const read = await resource("resources/read", { uri: GUIDE_URI }, down);
  assert.equal(read.error?.code, -32603);
  assert.equal(read.logs[0]?.outcome, "unavailable");
  // Control: a database missing a form's skill fails the read too, rather than serving a gap.
  const gap = seed();
  gap.skills = gap.skills.filter((row) => row.form !== "image");
  assert.equal(
    (await resource("resources/read", { uri: GUIDE_URI }, gap)).error?.code,
    -32603,
  );
});

Deno.test("add_cards skips a front already in the deck or earlier in the call, ignoring case and width, and never overwrites", async () => {
  const { result, fake } = await call("add_cards", {
    deck_id: ADA_DECK,
    cards: [
      { front: "ＡＰＰＬＥ", back: "different" },
      { front: "grape", back: "포도" },
      { front: "Grape ", back: "포도 again" },
    ],
  });
  assert.deepEqual(
    (result.structuredContent?.added as Row[]).map((a) => a.index),
    [1],
  );
  const skipped = result.structuredContent?.skipped as Row[];
  assert.deepEqual(skipped.map((s) => [s.index, s.existing_card_id]), [
    [0, "00000000-0000-7000-8000-000000000c01"],
    [2, (result.structuredContent?.added as Row[])[0]!.id],
  ]);
  const apple = fake.cards.find((row) =>
    row.id === "00000000-0000-7000-8000-000000000c01"
  )!;
  assert.equal(
    ((apple.back as Row[])[0]!.payload as Row).senses !== undefined,
    true,
  );
  assert.equal(fake.cards.filter((row) => row.deck_id === ADA_DECK).length, 5);
});

Deno.test("add_cards adds a duplicate front when allow_duplicates is true", async () => {
  const { result } = await call("add_cards", {
    deck_id: ADA_DECK,
    cards: [{ front: "apple", back: "또 사과" }],
    allow_duplicates: true,
  });
  assert.equal((result.structuredContent?.added as Row[]).length, 1);
  assert.deepEqual(result.structuredContent?.skipped, []);
});

Deno.test("add_cards refuses a card with an empty back by its index and adds the rest", async () => {
  const { result } = await call("add_cards", {
    deck_id: ADA_DECK,
    cards: [{ front: "empty", back: "  " }, { front: "kept", back: "남김" }],
  });
  assert.deepEqual(result.structuredContent?.refused, [
    { index: 0, reason: "back must be text of 1 to 2000 characters." },
  ]);
  assert.deepEqual(
    (result.structuredContent?.added as Row[]).map((a) => a.index),
    [1],
  );
});

Deno.test("add_cards refuses 101 cards and writes nothing, and adds 100", async () => {
  const many = (count: number) =>
    Array.from(
      { length: count },
      (_, index) => ({ front: `word ${index}`, back: "뜻" }),
    );
  const over = await call("add_cards", { deck_id: ADA_DECK, cards: many(101) });
  assert.equal(over.result.isError, true);
  assert.match(over.result.content[0]!.text, /at most 100 cards per call/);
  assert.ok(
    over.fake.calls.every((c) =>
      c.method !== "POST" || c.url.endsWith("/rpc/my_plan")
    ),
  );
  const cap = await call("add_cards", { deck_id: ADA_DECK, cards: many(100) });
  assert.equal((cap.result.structuredContent?.added as Row[]).length, 100);
  assert.equal(
    cap.fake.calls.filter((c) =>
      c.method === "POST" && !c.url.includes("/rpc/")
    ).length,
    1,
  );
});

Deno.test("add_cards refuses another user's deck and writes nothing, as the same call adds to the caller's own", async () => {
  const cards = [{ front: "pear", back: "배" }];
  const foreign = await call("add_cards", {
    deck_id: GRACE_PUBLIC_DECK,
    cards,
  });
  assert.equal(foreign.result.isError, true);
  assert.ok(
    foreign.fake.calls.every((c) =>
      c.method !== "POST" || c.url.endsWith("/rpc/my_plan")
    ),
  );
  assert.equal(
    foreign.fake.cards.filter((row) => row.deck_id === GRACE_PUBLIC_DECK)
      .length,
    1,
  );
  const own = await call(
    "add_cards",
    { deck_id: GRACE_PUBLIC_DECK, cards },
    seed(),
    GRACE_TOKEN,
  );
  assert.equal((own.result.structuredContent?.added as Row[]).length, 1);
});

Deno.test("a tool whose database cannot be reached answers an error result the model can retry on", async () => {
  const fake = seed();
  fake.rest = "offline";
  const { result, logs } = await call("list_decks", {}, fake);
  assert.equal(result.isError, true);
  assert.match(result.content[0]!.text, /try again/);
  assert.deepEqual(logs, [{
    user_id: ADA,
    method: "tools/call",
    tool: "list_decks",
    outcome: "unavailable",
  }]);
});

Deno.test("an unknown tool is refused with the names of the tools", async () => {
  const { result } = await call("drop_deck", {});
  assert.equal(result.isError, true);
  assert.match(
    result.content[0]!.text,
    /list_decks, list_cards, search_cards, create_deck, add_cards, update_cards, delete_cards, update_deck, delete_deck/,
  );
});

Deno.test("cards added in one call within one millisecond are listed in the call's order", async () => {
  const fake = seed();
  // A frozen clock, and random bits that fall with each id, so the ids sort against insertion.
  let fall = 255;
  const ids: IdSource = {
    now: () => Date.UTC(2026, 9, 29),
    random: (bytes) => new Uint8Array(bytes).fill(fall--),
  };
  const cards = ["first", "second", "third"].map((front) => ({
    front,
    back: "뜻",
  }));
  await call(
    "add_cards",
    { deck_id: ADA_OTHER_DECK, cards },
    fake,
    ADA_TOKEN,
    ids,
  );
  const { result } = await call(
    "list_cards",
    { deck_id: ADA_OTHER_DECK },
    fake,
  );
  assert.deepEqual(
    (result.structuredContent?.cards as { blocks: Row[] }[]).map((card) =>
      card.blocks[0]!.front
    ),
    ["cell", "first", "second", "third"],
  );
});

const APPLE = "00000000-0000-7000-8000-000000000c01";
const BANANA = "00000000-0000-7000-8000-000000000c02";
const CHERRY = "00000000-0000-7000-8000-000000000c03";
const DELETED_CARD = "00000000-0000-7000-8000-000000000c04";
const CELL = "00000000-0000-7000-8000-000000000c05";
const GRACE_CARD = "00000000-0000-7000-8000-000000000c06";
const UNKNOWN_CARD = "00000000-0000-7000-8000-0000000000ff";
/** The call's time, when a test fixes the clock. */
const CALL_TIME = Date.UTC(2026, 10, 2, 9, 30);
const FIXED: IdSource = {
  now: () => CALL_TIME,
  random: (bytes) => crypto.getRandomValues(new Uint8Array(bytes)),
};

const cardRow = (fake: Fake, id: string) =>
  fake.cards.find((row) => row.id === id)!;
const deckRow = (fake: Fake, id: string) =>
  fake.decks.find((row) => row.id === id)!;

Deno.test("delete_cards tombstones each live card of the caller's at the call's time, under a new revision, removing no row, and lists those not found", async () => {
  const fake = seed();
  const rowsBefore = fake.cards.length;
  const { result } = await call(
    "delete_cards",
    { card_ids: [BANANA, UNKNOWN_CARD, DELETED_CARD, APPLE, BANANA] },
    fake,
    ADA_TOKEN,
    FIXED,
  );
  assert.deepEqual(result.structuredContent, {
    deleted: [BANANA, APPLE],
    not_found: [UNKNOWN_CARD, DELETED_CARD],
    files_not_released: [],
  });
  assert.equal(fake.cards.length, rowsBefore);
  const at = new Date(CALL_TIME).toISOString();
  for (const id of [BANANA, APPLE]) {
    const row = cardRow(fake, id);
    assert.equal(row.deleted_at, at);
    assert.equal(row.updated_at, at);
    assert.ok((row.revision as number) > 100);
  }
  // The earlier tombstone and the rest keep what they held.
  assert.equal(cardRow(fake, DELETED_CARD).deleted_at, "2026-10-05");
  assert.equal(cardRow(fake, CHERRY).deleted_at, null);
  assert.equal(fake.card_states.length, 1);
  assert.ok(fake.calls.every((c) => !c.url.includes("card_states")));
  const listed = await call("list_cards", { deck_id: ADA_DECK }, fake);
  assert.deepEqual(
    (listed.result.structuredContent?.cards as Row[]).map((card) => card.id),
    [CHERRY],
  );
});

Deno.test("delete_cards refuses 101 ids and writes nothing, and deletes 100", async () => {
  const many = (count: number) =>
    Array.from(
      { length: count },
      (_, index) =>
        `00000000-0000-7000-8000-${index.toString(16).padStart(12, "0")}`,
    );
  const over = await call("delete_cards", { card_ids: many(101) });
  assert.equal(over.result.isError, true);
  assert.match(over.result.content[0]!.text, /at most 100 ids per call/);
  assert.ok(over.fake.calls.every((c) => c.method !== "PATCH"));
  const cap = await call("delete_cards", { card_ids: many(100) });
  assert.equal(cap.result.isError, undefined);
  assert.equal(
    (cap.result.structuredContent?.not_found as string[]).length,
    100,
  );
  assert.equal(cap.fake.calls.filter((c) => c.method === "PATCH").length, 1);
});

Deno.test("delete_cards refuses a call with an id that is not a uuid and writes nothing", async () => {
  const { result, fake } = await call("delete_cards", {
    card_ids: [APPLE, "apple"],
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0]!.text, /Nothing was deleted/);
  assert.ok(fake.calls.every((c) => c.method !== "PATCH"));
  assert.equal(cardRow(fake, APPLE).deleted_at, null);
});

Deno.test("delete_cards leaves another user's card in a public deck, which the caller can read, and deletes the caller's own in the same call", async () => {
  const fake = seed();
  const { result } = await call("delete_cards", {
    card_ids: [GRACE_CARD, CELL],
  }, fake);
  assert.deepEqual(result.structuredContent, {
    deleted: [CELL],
    not_found: [GRACE_CARD],
    files_not_released: [],
  });
  assert.equal(cardRow(fake, GRACE_CARD).deleted_at, null);
  assert.equal(cardRow(fake, GRACE_CARD).revision, undefined);
  const own = await call(
    "delete_cards",
    { card_ids: [GRACE_CARD] },
    seed(),
    GRACE_TOKEN,
  );
  assert.deepEqual(own.result.structuredContent?.deleted, [GRACE_CARD]);
});

Deno.test("update_deck renames a live deck of the caller's, trimmed, at the call's time", async () => {
  const fake = seed();
  const { result } = await call(
    "update_deck",
    { deck_id: ADA_DECK, name: "  English words  " },
    fake,
    ADA_TOKEN,
    FIXED,
  );
  assert.deepEqual(result.structuredContent, {
    deck: { id: ADA_DECK, name: "English words" },
  });
  const row = deckRow(fake, ADA_DECK);
  assert.equal(row.name, "English words");
  assert.equal(row.updated_at, new Date(CALL_TIME).toISOString());
  assert.ok((row.revision as number) > 100);
  assert.equal(row.deleted_at, null);
});

Deno.test("update_deck refuses an empty name and one of 501 characters, and takes one of 500", async () => {
  for (const name of ["   ", "a".repeat(501)]) {
    const { result, fake } = await call("update_deck", {
      deck_id: ADA_DECK,
      name,
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /1 to 500 characters/);
    assert.equal(deckRow(fake, ADA_DECK).name, "영단어");
  }
  const { result } = await call("update_deck", {
    deck_id: ADA_DECK,
    name: "a".repeat(500),
  });
  assert.equal(result.isError, undefined);
});

Deno.test("update_deck refuses another user's public deck and a deleted deck, as it renames the caller's own", async () => {
  for (const deck_id of [GRACE_PUBLIC_DECK, ADA_DELETED_DECK, UNKNOWN_CARD]) {
    const { result, fake } = await call("update_deck", {
      deck_id,
      name: "Mine now",
    });
    assert.equal(result.isError, true, deck_id);
    assert.match(result.content[0]!.text, /Call list_decks/);
    assert.notEqual(deckRow(fake, GRACE_PUBLIC_DECK).name, "Mine now");
    assert.notEqual(deckRow(fake, ADA_DELETED_DECK).name, "Mine now");
  }
  const own = await call(
    "update_deck",
    { deck_id: GRACE_PUBLIC_DECK, name: "Mine now" },
    seed(),
    GRACE_TOKEN,
  );
  assert.equal(deckRow(own.fake, GRACE_PUBLIC_DECK).name, "Mine now");
});

Deno.test("delete_deck tombstones a deck of the caller's and its live cards at one time, leaving its earlier tombstone, its study state and other decks", async () => {
  const fake = seed();
  const { result } = await call(
    "delete_deck",
    { deck_id: ADA_DECK },
    fake,
    ADA_TOKEN,
    FIXED,
  );
  assert.deepEqual(result.structuredContent, {
    deck: { id: ADA_DECK, name: "영단어" },
    deleted_cards: 3,
    files_not_released: [],
  });
  const at = new Date(CALL_TIME).toISOString();
  for (
    const row of [
      deckRow(fake, ADA_DECK),
      ...[APPLE, BANANA, CHERRY].map((id) => cardRow(fake, id)),
    ]
  ) {
    assert.equal(row.deleted_at, at);
    assert.equal(row.updated_at, at);
    assert.ok((row.revision as number) > 100);
  }
  assert.equal(cardRow(fake, DELETED_CARD).deleted_at, "2026-10-05");
  assert.equal(cardRow(fake, CELL).deleted_at, null);
  assert.equal(deckRow(fake, ADA_OTHER_DECK).deleted_at, null);
  assert.equal(fake.cards.length, seed().cards.length);
  assert.equal(fake.card_states.length, 1);
  const listed = await call("list_decks", {}, fake);
  assert.deepEqual(listed.result.structuredContent, {
    decks: [{ id: ADA_OTHER_DECK, name: "Biology", card_count: 1 }],
  });
});

Deno.test("delete_deck refuses another user's public deck and an already deleted one, writing nothing, as it deletes the caller's own", async () => {
  for (const deck_id of [GRACE_PUBLIC_DECK, ADA_DELETED_DECK]) {
    const { result, fake } = await call("delete_deck", { deck_id });
    assert.equal(result.isError, true, deck_id);
    assert.match(result.content[0]!.text, /Call list_decks/);
    assert.ok(fake.calls.every((c) => c.method !== "PATCH"));
  }
  const own = await call(
    "delete_deck",
    { deck_id: GRACE_PUBLIC_DECK },
    seed(),
    GRACE_TOKEN,
  );
  assert.equal(own.result.structuredContent?.deleted_cards, 1);
  assert.notEqual(deckRow(own.fake, GRACE_PUBLIC_DECK).deleted_at, null);
});

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FREE_CARD = "00000000-0000-7000-8000-000000000c07";
const CARD_PHOTO = "00000000-0000-7000-8000-0000000000a1";
const CARD_SOUND = "00000000-0000-7000-8000-0000000000a2";
const DECK_IMAGE = "00000000-0000-7000-8000-0000000000a3";

/** A seed with a `free` v2 card in Biology holding a 글, a photo and a sound, their files stored. */
function withFreeCard(): Fake {
  const fake = withPhoto();
  const at = "2026-10-07T00:00:00.000Z";
  fake.cards.push({
    id: FREE_CARD,
    deck_id: ADA_OTHER_DECK,
    user_id: ADA,
    template: "free",
    template_version: 2,
    front: [
      {
        type: "text",
        v: 2,
        id: "b-text",
        payload: { front: "heart", back: "pumps blood" },
      },
      {
        type: "image",
        v: 2,
        id: "b-photo",
        payload: {
          media: CARD_PHOTO,
          width: 640,
          height: 480,
          boxes: [],
          side: "back",
        },
      },
      {
        type: "audio",
        v: 2,
        id: "b-sound",
        payload: { media: CARD_SOUND, duration_ms: 1200, side: "back" },
      },
    ],
    back: [],
    card_key: "heart",
    source: "manual",
    deleted_at: null,
    created_at: at,
    updated_at: at,
  });
  fake.card_states.push({ card_id: FREE_CARD, user_id: ADA, stability: 2 });
  for (const [id, kind] of [[CARD_PHOTO, "image"], [CARD_SOUND, "audio"]]) {
    fake.media.push({ id, user_id: ADA, kind });
    fake.objects.set(`${ADA}/${id}`, { bytes: pngBytes(), type: null });
  }
  return fake;
}

Deno.test("update_cards replaces a card's 칸 whole, keeping the ids it is given of the card's own blocks, its photo and sound by media unfetched, and its study state", async () => {
  const fake = withFreeCard();
  const listed = await call("list_cards", { deck_id: ADA_OTHER_DECK }, fake);
  const read = (listed.result.structuredContent?.cards as {
    id: string;
    blocks: Row[];
  }[]).find((card) => card.id === FREE_CARD)!;
  assert.deepEqual(read.blocks.map((block) => block.id), [
    "b-text",
    "b-photo",
    "b-sound",
  ]);
  const [text, photo, sound] = read.blocks as [Row, Row, Row];
  const states = structuredClone(fake.card_states);
  const { result } = await call(
    "update_cards",
    {
      cards: [{
        id: FREE_CARD,
        blocks: [
          { ...text, front: "Heart" },
          {
            type: "image",
            id: photo.id,
            media: photo.media,
            width: photo.width,
            height: photo.height,
            boxes: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2, answer: "valve" }],
          },
          sound,
          // An id of the card's, but of another type, and one given twice: both minted.
          { type: "text", id: "b-photo", front: "", back: "a muscle" },
          { type: "text", id: "b-text", back: "four chambers" },
        ],
      }],
    },
    fake,
    ADA_TOKEN,
    FIXED,
  );
  assert.deepEqual(result.structuredContent, {
    // A boxed photo shows first, read as the phone's plainText reads it: its media id and answers.
    updated: [{
      index: 0,
      id: FREE_CARD,
      front: `Heart\n${CARD_PHOTO}\nvalve`,
    }],
    refused: [],
    files_not_released: [],
  });
  const row = cardRow(fake, FREE_CARD);
  const blocks = row.front as { id: string; payload: Row }[];
  assert.deepEqual(blocks.slice(0, 3).map((block) => block.id), [
    "b-text",
    "b-photo",
    "b-sound",
  ]);
  assert.ok(blocks.slice(3).every((block) => UUID_V7.test(block.id)));
  assert.deepEqual(blocks[1]!.payload, {
    media: CARD_PHOTO,
    width: 640,
    height: 480,
    boxes: [{
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.2,
      answer: "valve",
      id: (blocks[1]!.payload.boxes as Row[])[0]!.id,
    }],
  });
  assert.ok(UUID_V7.test((blocks[1]!.payload.boxes as Row[])[0]!.id as string));
  assert.deepEqual(blocks[2]!.payload, {
    media: CARD_SOUND,
    duration_ms: 1200,
    side: "back",
  });
  assert.ok(fake.calls.every((c) => !c.url.startsWith("https://cdn.example")));
  assert.equal(row.updated_at, new Date(CALL_TIME).toISOString());
  assert.ok((row.revision as number) > 100);
  assert.equal(row.source, "manual");
  assert.equal(row.created_at, "2026-10-07T00:00:00.000Z");
  assert.deepEqual(fake.card_states, states);
  assert.ok(fake.calls.every((c) => !c.url.includes("card_states")));
});

Deno.test("update_cards writes a card of two sides as free v2 with the key of its new front, and fetches a new photo", async () => {
  const fake = withPhoto();
  const { result } = await call(
    "update_cards",
    {
      cards: [{
        id: BANANA,
        blocks: [
          { type: "text", front: "  Plantain ", back: "플랜테인" },
          { type: "image", url: PHOTO, side: "back" },
        ],
      }],
    },
    fake,
    ADA_TOKEN,
    FIXED,
  );
  assert.deepEqual(result.structuredContent?.refused, []);
  const row = cardRow(fake, BANANA);
  assert.equal(row.template, "free");
  assert.equal(row.template_version, 2);
  assert.deepEqual(row.back, []);
  assert.equal(row.card_key, "plantain");
  const photo = (row.front as { payload: Row }[])[1]!.payload;
  assert.equal(photo.width, 640);
  assert.ok(fake.objects.has(`${ADA}/${photo.media}`));
});

Deno.test("update_cards refuses 101 cards and writes nothing, and answers 100 card by card", async () => {
  const many = (count: number) =>
    Array.from({ length: count }, () => ({
      id: UNKNOWN_CARD,
      front: "x",
      back: "y",
    }));
  const over = await call("update_cards", { cards: many(101) });
  assert.equal(over.result.isError, true);
  assert.match(over.result.content[0]!.text, /at most 100 cards per call/);
  assert.ok(over.fake.calls.every((c) => c.method !== "PATCH"));
  const cap = await call("update_cards", { cards: many(100) });
  assert.equal(cap.result.isError, undefined);
  assert.equal(
    (cap.result.structuredContent?.refused as Row[]).length,
    100,
  );
});

Deno.test("update_cards refuses by index an id that is not a live card of the caller's, another user's public one included, and updates the caller's own in the same call", async () => {
  const fake = seed();
  const { result } = await call("update_cards", {
    cards: [
      { id: GRACE_CARD, front: "mine", back: "now" },
      { id: DELETED_CARD, front: "back", back: "again" },
      { id: UNKNOWN_CARD, front: "who", back: "?" },
      { id: "cell", front: "not", back: "an id" },
      { id: CELL, front: "cytoplasm", back: "세포질" },
    ],
  }, fake);
  const { updated, refused } = result.structuredContent as {
    updated: Row[];
    refused: Row[];
  };
  assert.deepEqual(refused.map((r) => r.index), [0, 1, 2, 3]);
  for (const r of refused) {
    assert.match(String(r.reason), /No card of the signed-in user has this id/);
  }
  assert.deepEqual(updated.map((u) => u.id), [CELL]);
  assert.equal(cardRow(fake, GRACE_CARD).revision, undefined);
  assert.equal(cardRow(fake, DELETED_CARD).revision, undefined);
  const own = await call(
    "update_cards",
    { cards: [{ id: GRACE_CARD, front: "mine", back: "now" }] },
    seed(),
    GRACE_TOKEN,
  );
  assert.equal((own.result.structuredContent?.updated as Row[]).length, 1);
});

Deno.test("update_cards refuses a card by its index and the block's, with add_cards' sentences, leaving it as it was", async () => {
  const fake = withFreeCard();
  const before = structuredClone(cardRow(fake, CELL));
  const { result } = await call("update_cards", {
    cards: [
      {
        id: CELL,
        blocks: [
          { type: "text", front: "a", back: "b" },
          { type: "cloze", text: "no blank here", answers: ["x"] },
        ],
      },
      // A photo or a sound of another card's is not this card's to keep.
      {
        id: CELL,
        blocks: [{ type: "image", media: CARD_PHOTO, side: "front" }, {
          type: "text",
          back: "b",
        }],
      },
      {
        id: CELL,
        blocks: [{ type: "text", front: "a", back: "b" }, {
          type: "audio",
          media: CARD_SOUND,
          side: "back",
        }],
      },
      { id: CELL, blocks: [{ type: "text", front: "only a front" }] },
      { id: APPLE, front: "apple", back: "사과" },
    ],
  }, fake);
  const { updated, refused } = result.structuredContent as {
    updated: Row[];
    refused: { index: number; reason: string }[];
  };
  assert.deepEqual(refused.map((r) => r.index), [0, 1, 2, 3]);
  assert.match(refused[0]!.reason, /^block 1: a cloze needs text with one ___/);
  assert.match(
    refused[1]!.reason,
    /^block 0: an image block by media must name a photo this card already holds/,
  );
  assert.match(
    refused[2]!.reason,
    /^block 1: an audio block must name a sound this card already holds/,
  );
  assert.match(refused[3]!.reason, /^the card adds nothing at the reveal/);
  assert.deepEqual(updated.map((u) => u.id), [APPLE]);
  assert.deepEqual(cardRow(fake, CELL), before);
});

Deno.test("update_cards refuses a new front another card of the deck shows, or one an earlier card of the call took, unless allow_duplicates, and a card may keep its own", async () => {
  const fake = seed();
  const { result } = await call("update_cards", {
    cards: [
      { id: BANANA, front: "Apple", back: "사과 2" },
      { id: APPLE, front: "apple", back: "사과!" },
      { id: CHERRY, front: "kiwi", back: "키위" },
      { id: BANANA, front: "KIWI", back: "키위 2" },
      // The same front in another deck is no duplicate.
      { id: CELL, front: "apple", back: "사과 3" },
    ],
  }, fake);
  const { updated, refused } = result.structuredContent as {
    updated: Row[];
    refused: { index: number; reason: string }[];
  };
  assert.deepEqual(refused.map((r) => r.index), [0, 3]);
  assert.match(
    refused[0]!.reason,
    new RegExp(`card ${APPLE} in the same deck`),
  );
  assert.match(
    refused[1]!.reason,
    new RegExp(`card ${CHERRY} in the same deck`),
  );
  assert.deepEqual(updated.map((u) => u.index), [1, 2, 4]);
  assert.equal(cardRow(fake, BANANA).card_key, "banana");
  const allowed = await call("update_cards", {
    cards: [{ id: BANANA, front: "Apple", back: "사과 2" }],
    allow_duplicates: true,
  }, fake);
  assert.deepEqual(allowed.result.structuredContent?.refused, []);
  assert.equal(cardRow(fake, BANANA).card_key, "apple");
});

Deno.test("update_cards refuses a card holding a block of a later version and a card edited after the call began, and updates the rest", async () => {
  const fake = seed();
  cardRow(fake, BANANA).front = [
    { type: "text", v: 1, payload: { text: "Banana" } },
    { type: "hologram", v: 1, payload: {} },
  ];
  cardRow(fake, CHERRY).updated_at = "2026-12-01T00:00:00.000Z";
  const { result } = await call(
    "update_cards",
    {
      cards: [
        { id: BANANA, front: "banana", back: "바나나" },
        { id: CHERRY, front: "cherry", back: "체리" },
        { id: APPLE, front: "apple", back: "사과" },
      ],
    },
    fake,
    ADA_TOKEN,
    FIXED,
  );
  const { updated, refused } = result.structuredContent as {
    updated: Row[];
    refused: { index: number; reason: string }[];
  };
  assert.match(refused[0]!.reason, /newer version of knowno/);
  assert.match(refused[1]!.reason, /changed elsewhere after this call began/);
  assert.deepEqual(refused.map((r) => r.index), [0, 1]);
  assert.deepEqual(updated.map((u) => u.id), [APPLE]);
  assert.equal(cardRow(fake, CHERRY).updated_at, "2026-12-01T00:00:00.000Z");
  assert.equal(cardRow(fake, BANANA).revision, undefined);
});

Deno.test("update_cards fetches ten photos a call, an eleventh card refused with what to do", async () => {
  const fake = withPhoto();
  const ids = Array.from(
    { length: 11 },
    (_, index) =>
      `00000000-0000-7000-8000-0000000001${
        index.toString(16).padStart(2, "0")
      }`,
  );
  for (const id of ids) {
    fake.cards.push(
      card(id, ADA_OTHER_DECK, ADA, [block("text", { text: id })], [
        block("text", { text: "뜻" }),
      ], { created_at: "2026-10-09", updated_at: "2026-10-09" }),
    );
  }
  const { result } = await call("update_cards", {
    cards: ids.map((id) => ({
      id,
      blocks: [{ type: "text", front: id }, {
        type: "image",
        url: PHOTO,
        side: "back",
      }],
    })),
  }, fake);
  const { updated, refused } = result.structuredContent as {
    updated: Row[];
    refused: { index: number; reason: string }[];
  };
  assert.equal(updated.length, 10);
  assert.deepEqual(refused.map((r) => r.index), [10]);
  assert.match(refused[0]!.reason, /at most 10 photos per call/);
});

Deno.test("tools/list marks the read tools read-only, the writes not destructive and the deletions destructive", async () => {
  const run = await send({
    body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  const tools = (run.json as {
    result: { tools: { name: string; annotations: Row }[] };
  }).result.tools;
  const hints = Object.fromEntries(
    tools.map((tool) => [tool.name, [
      tool.annotations.readOnlyHint,
      tool.annotations.destructiveHint,
    ]]),
  );
  assert.deepEqual(hints, {
    list_decks: [true, undefined],
    list_cards: [true, undefined],
    search_cards: [true, undefined],
    create_deck: [false, false],
    add_cards: [false, false],
    update_cards: [false, false],
    update_deck: [false, false],
    delete_cards: [false, true],
    delete_deck: [false, true],
  });
});

Deno.test("initialize asks the model to confirm a deletion with the user and to prefer update_cards", async () => {
  const run = await send({
    body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
  });
  const { instructions } = (run.json as { result: { instructions: string } })
    .result;
  assert.match(
    instructions,
    /Before delete_cards or delete_deck, confirm with the user/,
  );
  assert.match(
    instructions,
    /prefer that to deleting a card and adding a new one/,
  );
});

Deno.test("delete_cards releases the photos and sounds no live card or deck holds, and keeps those another holds", async () => {
  const free = withFreeCard();
  const released = await call("delete_cards", { card_ids: [FREE_CARD] }, free);
  assert.deepEqual(released.result.structuredContent?.files_not_released, []);
  assert.equal(free.objects.size, 0);
  assert.deepEqual(free.media, []);
  const held = withFreeCard();
  held.cards.push(
    card("00000000-0000-7000-8000-000000000c08", ADA_DECK, ADA, [
      block("text", { text: "valve" }),
    ], [block("image", { media: CARD_PHOTO, width: 1, height: 1, boxes: [] })]),
  );
  deckRow(held, ADA_DECK).image_media_id = CARD_SOUND;
  const kept = await call("delete_cards", { card_ids: [FREE_CARD] }, held);
  assert.deepEqual(kept.result.structuredContent?.deleted, [FREE_CARD]);
  assert.deepEqual(kept.result.structuredContent?.files_not_released, []);
  assert.equal(held.objects.size, 2);
  assert.equal(held.media.length, 2);
});

Deno.test("delete_cards keeps its deletion when Storage refuses the release, and names the files not released", async () => {
  const fake = withFreeCard();
  fake.storage = "refusing";
  const { result } = await call(
    "delete_cards",
    { card_ids: [FREE_CARD] },
    fake,
  );
  assert.deepEqual(result.structuredContent, {
    deleted: [FREE_CARD],
    not_found: [],
    files_not_released: [CARD_PHOTO, CARD_SOUND],
  });
  assert.notEqual(cardRow(fake, FREE_CARD).deleted_at, null);
  assert.equal(fake.objects.size, 2);
  assert.equal(fake.media.length, 2);
});

Deno.test("delete_deck releases the deck's image and its cards' photos and sounds", async () => {
  const fake = withFreeCard();
  deckRow(fake, ADA_OTHER_DECK).image_media_id = DECK_IMAGE;
  fake.media.push({ id: DECK_IMAGE, user_id: ADA, kind: "image" });
  fake.objects.set(`${ADA}/${DECK_IMAGE}`, { bytes: pngBytes(), type: null });
  const { result } = await call(
    "delete_deck",
    { deck_id: ADA_OTHER_DECK },
    fake,
  );
  assert.deepEqual(result.structuredContent, {
    deck: { id: ADA_OTHER_DECK, name: "Biology" },
    deleted_cards: 2,
    files_not_released: [],
  });
  assert.equal(fake.objects.size, 0);
  assert.deepEqual(fake.media, []);
});

/** The media ids of the files the call uploaded, in order. */
const uploaded = (fake: Fake) =>
  fake.calls.filter((c) =>
    c.method === "POST" &&
    c.url.startsWith(`${SUPABASE_URL}/storage/v1/object/media/${ADA}/`)
  ).map((c) => c.url.split("/").at(-1)!);

/** A card whose front photo is stored before its back photo's fetch is refused. */
const REFUSED_AFTER_STORE = {
  blocks: [
    { type: "image", url: PHOTO, side: "front" },
    { type: "image", url: "https://inner.example/a.png", side: "back" },
  ],
};

Deno.test("add_cards releases the photo it stored for a card it then refused, and keeps the photo of a card it added", async () => {
  const fake = withPhoto();
  fake.dns["inner.example"] = ["10.0.0.1"];
  const { result } = await call("add_cards", {
    deck_id: ADA_DECK,
    cards: [REFUSED_AFTER_STORE, {
      blocks: [{ type: "image", url: PHOTO, boxes: [BOX] }],
    }],
  }, fake);
  const [orphan, kept] = uploaded(fake);
  assert.ok(orphan !== undefined && kept !== undefined);
  assert.deepEqual(
    (result.structuredContent?.refused as Row[]).map((r) => r.index),
    [0],
  );
  assert.deepEqual(result.structuredContent?.files_not_released, []);
  assert.deepEqual(fake.media.map((row) => row.id), [kept]);
  assert.deepEqual([...fake.objects.keys()], [`${ADA}/${kept}`]);
});

Deno.test("add_cards names the photo of a refused card that Storage would not delete, the call answering", async () => {
  const fake = withPhoto();
  fake.dns["inner.example"] = ["10.0.0.1"];
  fake.storage = "keeping";
  const { result } = await call("add_cards", {
    deck_id: ADA_DECK,
    cards: [REFUSED_AFTER_STORE, {
      blocks: [{ type: "text", front: "kept", back: "남김" }],
    }],
  }, fake);
  const [orphan] = uploaded(fake);
  assert.equal(result.isError, undefined);
  assert.equal((result.structuredContent?.added as Row[]).length, 1);
  assert.deepEqual(result.structuredContent?.files_not_released, [orphan]);
  assert.ok(fake.objects.has(`${ADA}/${orphan}`));
});

Deno.test("add_cards whose insert fails releases every photo it stored, answering the error to retry on", async () => {
  const fake = withPhoto();
  fake.dns["inner.example"] = ["10.0.0.1"];
  fake.rest = "refusing card writes";
  const { result } = await call("add_cards", {
    deck_id: ADA_DECK,
    cards: [REFUSED_AFTER_STORE, {
      blocks: [{ type: "image", url: PHOTO, boxes: [BOX] }],
    }],
  }, fake);
  assert.equal(uploaded(fake).length, 2);
  assert.equal(result.isError, true);
  assert.match(result.content[0]!.text, /try again/);
  assert.deepEqual(fake.media, []);
  assert.equal(fake.objects.size, 0);
  assert.equal(fake.cards.length, seed().cards.length);
});

Deno.test("update_cards releases the photo it stored for a card edited after the call began, and keeps the photo of a card it updated", async () => {
  const fake = withPhoto();
  cardRow(fake, CHERRY).updated_at = "2026-12-01T00:00:00.000Z";
  const photoBack = { type: "image", url: PHOTO, side: "back" };
  const { result } = await call("update_cards", {
    cards: [
      { id: CHERRY, blocks: [{ type: "text", front: "cherry" }, photoBack] },
      { id: BANANA, blocks: [{ type: "text", front: "banana" }, photoBack] },
    ],
  }, fake);
  const [orphan, kept] = uploaded(fake);
  assert.ok(orphan !== undefined && kept !== undefined);
  assert.deepEqual(
    (result.structuredContent?.refused as Row[]).map((r) => r.index),
    [0],
  );
  assert.deepEqual(result.structuredContent?.files_not_released, []);
  assert.deepEqual(fake.media.map((row) => row.id), [kept]);
  assert.deepEqual([...fake.objects.keys()], [`${ADA}/${kept}`]);
});

Deno.test("update_cards releases the photos it stored for a card a later photo refuses, naming those Storage would not delete", async () => {
  const fake = withPhoto();
  fake.dns["inner.example"] = ["10.0.0.1"];
  fake.storage = "keeping";
  const { result } = await call("update_cards", {
    cards: [{ id: BANANA, ...REFUSED_AFTER_STORE }],
  }, fake);
  const [orphan] = uploaded(fake);
  assert.equal(result.isError, undefined);
  assert.deepEqual(
    (result.structuredContent?.refused as Row[]).map((r) => r.index),
    [0],
  );
  assert.deepEqual(result.structuredContent?.files_not_released, [orphan]);
});

Deno.test("update_cards whose update fails releases the photo it stored for the card, answering the error to retry on", async () => {
  const fake = withPhoto();
  fake.rest = "refusing card writes";
  const { result } = await call("update_cards", {
    cards: [{
      id: BANANA,
      blocks: [{ type: "text", front: "banana" }, {
        type: "image",
        url: PHOTO,
        side: "back",
      }],
    }],
  }, fake);
  assert.equal(uploaded(fake).length, 1);
  assert.equal(result.isError, true);
  assert.match(result.content[0]!.text, /try again/);
  assert.deepEqual(fake.media, []);
  assert.equal(fake.objects.size, 0);
});

const MARKUP_CARDS = [
  { blocks: [{ type: "text", front: "Capital?", back: "Paris" }] },
  {
    blocks: [{ type: "text", front: "준비물\n- 여권\n- 지갑", back: "2*3*4" }],
  },
  {
    blocks: [{
      type: "cloze",
      text: "The capital of France is ___.",
      answers: ["Paris"],
    }],
  },
  { blocks: [{ type: "cloze", text: "{{c1::Seoul}} is the capital" }] },
  {
    blocks: [{
      type: "cloze",
      text: "{{c1::Seoul::city}} is the capital of Korea",
    }],
  },
  { blocks: [{ type: "cloze", text: "no cloze here" }] },
];

Deno.test("add_cards reads and writes text as the switch says: literal at version 2 as given and clozes at version 1 while off, markup at version 3 and clozes at version 2 while on, an Anki cloze with no version 1 form refused only while off", async () => {
  const off = await call("add_cards", {
    deck_id: ADA_DECK,
    cards: MARKUP_CARDS,
  }, seed());
  const on = seed();
  on.markup = true;
  const written = await call("add_cards", {
    deck_id: ADA_DECK,
    cards: MARKUP_CARDS,
  }, on);
  const stored = (done: Awaited<ReturnType<typeof call>>) =>
    (done.result.structuredContent?.added as Row[]).map((added) =>
      storedBlocks(done.fake.cards.find((row) => row.id === added.id)!)
    );
  const refused = (
    done: Awaited<ReturnType<typeof call>>,
  ) => (done.result.structuredContent?.refused as Row[]);
  assert.deepEqual(refused(off).map((r) => r.index), [4, 5]);
  assert.match(
    refused(off)[0]!.reason as string,
    /block 0: a cloze in \{\{c1::answer\}\} form cannot be written yet/,
  );
  assert.match(
    refused(off)[1]!.reason as string,
    /block 0: a cloze's text needs at least one \{\{c1::answer\}\}/,
  );
  assert.deepEqual(refused(written).map((r) => r.index), [5]);
  assert.deepEqual(stored(off), [
    [{ type: "text", v: 2, payload: { front: "Capital?", back: "Paris" } }],
    // A list and an asterisk pair stay literal while off, byte for byte.
    [{
      type: "text",
      v: 2,
      payload: { front: "준비물\n- 여권\n- 지갑", back: "2*3*4" },
    }],
    [{
      type: "cloze",
      v: 1,
      payload: { text: "The capital of France is ___.", answers: ["Paris"] },
    }],
    [{
      type: "cloze",
      v: 1,
      payload: { text: "___ is the capital", answers: ["Seoul"] },
    }],
  ]);
  assert.deepEqual(stored(written), [
    [{ type: "text", v: 3, payload: { front: "Capital?", back: "Paris" } }],
    [{
      type: "text",
      v: 3,
      payload: { front: "준비물\n- 여권\n- 지갑", back: "2*3*4" },
    }],
    [{
      type: "cloze",
      v: 2,
      payload: { text: "The capital of France is {{c1::Paris}}." },
    }],
    [{
      type: "cloze",
      v: 2,
      payload: { text: "{{c1::Seoul}} is the capital" },
    }],
    [{
      type: "cloze",
      v: 2,
      payload: { text: "{{c1::Seoul::city}} is the capital of Korea" },
    }],
  ]);
});

Deno.test("the switch is read as the caller, once for each add_cards, update_cards, list_cards and search_cards call", async () => {
  const asked = (fake: Fake) =>
    fake.calls.filter((one) => one.url.endsWith("/rpc/card_markup_enabled"));
  const { fake } = await call("add_cards", {
    deck_id: ADA_DECK,
    cards: [{ front: "pear", back: "배" }],
  });
  assert.equal(asked(fake).length, 1);
  assert.equal(
    asked(fake)[0]!.headers.get("Authorization"),
    `Bearer ${ADA_TOKEN}`,
  );
  assert.equal(asked(fake)[0]!.headers.get("apikey"), ANON_KEY);
  const calls = [
    ["update_cards", {
      cards: [{ id: FREE_CARD, blocks: [{ type: "text", front: "a" }] }],
    }],
    ["list_cards", { deck_id: ADA_OTHER_DECK }],
    ["search_cards", { query: "heart" }],
  ] as const;
  for (const [name, args] of calls) {
    const done = await call(name, args, withFreeCard());
    assert.equal(asked(done.fake).length, 1, name);
  }
});

Deno.test("update_cards writes a card's text as version 3 while the switch is on and as version 2 as given while it is off, and list_cards shows a stored literal as stored while off and escaped while on", async () => {
  const stored = async (markup: boolean) => {
    const fake = withFreeCard();
    fake.markup = markup;
    const { result } = await call("update_cards", {
      cards: [{
        id: FREE_CARD,
        blocks: [{ type: "text", front: "2*3*4\n- a", back: "x" }],
      }],
    }, fake);
    assert.deepEqual(result.structuredContent?.refused, []);
    return fake;
  };
  const off = await stored(false);
  assert.deepEqual(storedBlocks(off.cards.find((c) => c.id === FREE_CARD)!), [{
    type: "text",
    v: 2,
    payload: { front: "2*3*4\n- a", back: "x" },
  }]);
  const on = await stored(true);
  assert.deepEqual(storedBlocks(on.cards.find((c) => c.id === FREE_CARD)!), [{
    type: "text",
    v: 3,
    payload: { front: "2*3*4\n- a", back: "x" },
  }]);
  const shown = async (fake: Fake) => {
    const listed = await call("list_cards", { deck_id: ADA_OTHER_DECK }, fake);
    const card = (listed.result.structuredContent?.cards as {
      id: string;
      blocks: Row[];
    }[]).find((one) => one.id === FREE_CARD)!;
    return card.blocks[0]!.front;
  };
  assert.equal(await shown(off), "2*3*4\n- a");
  // The same stored version 2 text, read while on, is shown escaped so that update_cards keeps its meaning.
  off.markup = true;
  assert.equal(await shown(off), "2\\*3\\*4\n\\- a");
});

const makePublic = (fake: Fake) => {
  Object.assign(deckRow(fake, ADA_DECK), {
    visibility: "public",
    publication: "public",
  });
  return fake;
};

Deno.test("a write to a public note's text says it is checked again, whichever tool made it", async () => {
  const writes: [string, Record<string, unknown>][] = [
    ["add_cards", {
      deck_id: ADA_DECK,
      cards: [{ front: "cat", back: "고양이" }],
    }],
    ["delete_cards", { card_ids: [BANANA] }],
    ["update_deck", { deck_id: ADA_DECK, name: "English words" }],
  ];
  for (const [name, args] of writes) {
    const { result } = await call(name, args, makePublic(seed()));
    assert.match(
      String(result.structuredContent?.notice),
      /checked again/,
      name,
    );
  }
});

Deno.test("update_cards says it too, finding the note by the card", async () => {
  const fake = withFreeCard();
  const listed = await call("list_cards", { deck_id: ADA_OTHER_DECK }, fake);
  const read = (listed.result.structuredContent?.cards as {
    id: string;
    blocks: Row[];
  }[]).find((card) => card.id === FREE_CARD)!;
  Object.assign(deckRow(fake, ADA_OTHER_DECK), { publication: "public" });
  const { result } = await call(
    "update_cards",
    { cards: [{ id: FREE_CARD, blocks: read.blocks }] },
    fake,
  );
  assert.equal(result.isError, undefined);
  assert.match(String(result.structuredContent?.notice), /checked again/);
});

Deno.test("a write to a private note says nothing of a check", async () => {
  const { result } = await call("update_deck", {
    deck_id: ADA_DECK,
    name: "English words",
  });
  assert.equal(result.structuredContent?.notice, undefined);
});

const FREE_SENTENCE = /플러스/;

Deno.test("a 무료 user's connection is refused with a sentence naming 플러스, and a paid user's is not", async () => {
  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25" },
  };
  const free = seed();
  free.plan = "free";
  const refused = await send({ body: initialize, fake: free });
  assert.equal(refused.status, 403);
  const error = (refused.json as { error: { code: number; message: string } })
    .error;
  assert.equal(error.code, -32001);
  assert.match(error.message, FREE_SENTENCE);
  assert.deepEqual(refused.logs.map((entry) => entry.outcome), [
    "plan_refused",
  ]);
  for (const plan of ["pro", "max"] as const) {
    const paid = seed();
    paid.plan = plan;
    const run = await send({ body: initialize, fake: paid });
    assert.equal(run.status, 200, `control: ${plan} passes`);
    assert.equal(
      (run.json as { result: Row }).result.serverInfo !== undefined,
      true,
    );
  }
});

Deno.test("every tool call of a 무료 user is refused with the sentence and writes nothing, as the same call of a paid user is carried out", async () => {
  const call = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "create_deck", arguments: { name: "새 덱" } },
  };
  const free = seed();
  free.plan = "free";
  const decks = free.decks.length;
  const refused = await send({ body: call, fake: free });
  const result = (refused.json as {
    result: { isError: boolean; content: { text: string }[] };
  })
    .result;
  assert.equal(result.isError, true);
  assert.match(result.content[0]!.text, FREE_SENTENCE);
  assert.equal(free.decks.length, decks, "nothing is written");
  assert.deepEqual(refused.logs.map((entry) => [entry.tool, entry.outcome]), [
    ["create_deck", "plan_refused"],
  ]);
  for (const name of ["list_decks", "list_cards", "delete_deck", "nope"]) {
    const run = await send({
      body: { ...call, params: { name, arguments: {} } },
      fake: free,
    });
    assert.match(
      (run.json as { result: { content: { text: string }[] } }).result
        .content[0]!.text,
      FREE_SENTENCE,
      name,
    );
  }
  const paid = seed();
  const carried = await send({ body: call, fake: paid });
  assert.equal(
    (carried.json as { result: { isError?: boolean } }).result.isError,
    undefined,
    "control: a paid user's call is carried out",
  );
  assert.equal(paid.decks.length, decks + 1);
});

Deno.test("a plan that cannot be read refuses the connection and the call, as unavailable, never as a pass", async () => {
  for (const plan of ["down", "broken"] as const) {
    const fake = seed();
    fake.plan = plan;
    const decks = fake.decks.length;
    const initialize = await send({
      body: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      fake,
    });
    assert.equal(initialize.status, 503, plan);
    assert.deepEqual(initialize.logs.map((entry) => entry.outcome), [
      "unavailable",
    ]);
    const call = await send({
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "create_deck", arguments: { name: "새 덱" } },
      },
      fake,
    });
    assert.equal(
      (call.json as { result: { isError: boolean } }).result.isError,
      true,
      plan,
    );
    assert.equal(fake.decks.length, decks);
    assert.deepEqual(call.logs.map((entry) => entry.outcome), ["unavailable"]);
  }
});

Deno.test("the plan is read with the caller's own token, and only the connection and tool calls read it", async () => {
  const fake = seed();
  fake.plan = "free";
  const listed = await send({
    body: { jsonrpc: "2.0", id: 3, method: "tools/list" },
    fake,
  });
  assert.ok(
    (listed.json as { result: Row }).result.tools,
    "a 무료 user may list the tools",
  );
  assert.equal(
    fake.calls.filter((one) => one.url.endsWith("/rpc/my_plan")).length,
    0,
  );
  await send({
    body: {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "list_decks" },
    },
    fake,
  });
  const [read] = fake.calls.filter((one) => one.url.endsWith("/rpc/my_plan"));
  assert.equal(read?.headers.get("Authorization"), `Bearer ${ADA_TOKEN}`);
  assert.equal(read?.headers.get("apikey"), ANON_KEY);
});
