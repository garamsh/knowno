// The assistant end to end, with Supabase Auth, PostgREST, its functions, Vault and the providers
// replaced by an in-memory fake that applies row-level security's owner rule. No network.
import assert from "node:assert/strict";
import { createHandler, type LogEntry, MAX_MODEL_CALLS } from "./handler.ts";
import { readConfig } from "./config.ts";
import { ANTHROPIC_URL, OPENROUTER_URL } from "./providers.ts";
import type { Proposal } from "./tools.ts";

const SUPABASE_URL = "http://kong:8000";
const ADA = "00000000-0000-4000-8000-00000000000a";
const GRACE = "00000000-0000-4000-8000-00000000000b";
const ADA_DECK = "00000000-0000-7000-8000-0000000000d1";
const GRACE_DECK = "00000000-0000-7000-8000-0000000000e1";
const TOKENS: Record<string, string> = {
  "ada-token": ADA,
  "grace-token": GRACE,
};

type Row = Record<string, unknown>;

type Fake = {
  decks: Row[];
  cards: Row[];
  suspended: Set<string>;
  /** What `begin_assistant_message` answers beyond the configuration, and the day's count. */
  limit: number | null;
  used: number;
  keyed: boolean;
  configuration: Row;
  finished: Row[];
  /** The provider's replies in order, each given the request's body. */
  replies: ((body: Row) => Response)[];
  requests: Row[];
  writes: { method: string; table: string; body: unknown }[];
};

function seed(): Fake {
  return {
    decks: [
      {
        id: ADA_DECK,
        user_id: ADA,
        name: "영단어",
        deleted_at: null,
        created_at: "2026-10-01",
      },
      {
        id: GRACE_DECK,
        user_id: GRACE,
        name: "Grace's",
        deleted_at: null,
        created_at: "2026-10-01",
      },
    ],
    cards: [{
      id: "00000000-0000-7000-8000-000000000c01",
      deck_id: ADA_DECK,
      user_id: ADA,
      front: [{
        type: "text",
        v: 2,
        id: "00000000-0000-7000-8000-0000000000b1",
        payload: { front: "apple", back: "사과" },
      }],
      back: [],
      template: "free",
      template_version: 2,
      card_key: "apple",
      deleted_at: null,
      created_at: "2026-10-01",
    }],
    suspended: new Set(),
    limit: 10,
    used: 0,
    keyed: true,
    configuration: {
      configuration_id: 7,
      provider: "openrouter",
      model: "anthropic/claude-haiku-5.5",
      prompt_version_id: 9,
      prompt: "You are 말랑이.",
      web_search: false,
      max_searches: 3,
      reasoning_effort: "none",
    },
    finished: [],
    replies: [],
    requests: [],
    writes: [],
  };
}

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [key, value] of params) {
    if (
      ["select", "order", "limit", "offset"].includes(key) || key.includes(".")
    ) continue;
    if (value === "is.null" && row[key] !== null) return false;
    if (value.startsWith("eq.") && String(row[key]) !== value.slice(3)) {
      return false;
    }
    if (
      value.startsWith("in.(") &&
      !value.slice(4, -1).split(",").includes(String(row[key]))
    ) {
      return false;
    }
  }
  return true;
}

function rest(
  fake: Fake,
  url: URL,
  method: string,
  user: string | null,
  body: unknown,
) {
  if (user === null) {
    return Response.json({ code: "PGRST301" }, { status: 401 });
  }
  const table = url.pathname.split("/").at(-1)!;
  const rows = table === "decks"
    ? fake.decks
    : table === "cards"
    ? fake.cards
    : null;
  if (rows === null) return Response.json({}, { status: 404 });
  if (method === "POST") {
    for (const row of body as Row[]) {
      if (row.user_id !== user) {
        return Response.json({ code: "42501" }, { status: 403 });
      }
    }
    fake.writes.push({ method, table, body });
    rows.push(...(body as Row[]).map((row) => ({ deleted_at: null, ...row })));
    return new Response(null, { status: 201 });
  }
  if (method !== "GET") {
    fake.writes.push({ method, table, body });
    return Response.json([]);
  }
  const select = url.searchParams.get("select") ?? "";
  const found = rows.filter((row) =>
    row.user_id === user && matches(row, url.searchParams)
  );
  return Response.json(found.map((row) => {
    const out: Row = {};
    for (const column of select.split(",")) {
      if (column === "cards(count)") {
        out.cards = [{
          count: fake.cards.filter((c) =>
            c.deck_id === row.id && c.deleted_at === null
          ).length,
        }];
      } else out[column] = row[column];
    }
    return out;
  }));
}

function fakeFetch(fake: Fake): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string"
      ? JSON.parse(init.body)
      : undefined;
    const bearer = headers.get("Authorization")?.slice(7) ?? "";
    if (url.href === OPENROUTER_URL || url.href === ANTHROPIC_URL) {
      fake.requests.push(body);
      const reply = fake.replies.shift();
      if (reply === undefined) {
        throw new Error("the provider was called once too often");
      }
      return reply(body);
    }
    if (url.href === `${SUPABASE_URL}/auth/v1/user`) {
      const user = TOKENS[bearer];
      return user === undefined
        ? Response.json({ error_code: "bad_jwt" }, { status: 403 })
        : Response.json({ id: user });
    }
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/)?.[1];
    if (rpc !== undefined) {
      assert.equal(bearer, "service-role-key");
      switch (rpc) {
        case "user_suspended":
          return Response.json(fake.suspended.has(body.user_id));
        case "provider_key":
          return Response.json(fake.keyed ? "sk-test" : null);
        case "begin_assistant_message": {
          const allowed = fake.keyed &&
            (fake.limit === null || fake.used < fake.limit);
          if (allowed) fake.used++;
          return Response.json([{
            plan: "free",
            ...fake.configuration,
            available: fake.keyed,
            daily_limit: fake.limit,
            used: fake.used,
            allowed,
            message_id: allowed ? 41 : null,
          }]);
        }
        case "finish_assistant_message":
          fake.finished.push(body);
          return new Response(null, { status: 204 });
      }
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      assert.equal(headers.get("apikey"), "anon-key");
      return await rest(fake, url, method, TOKENS[bearer] ?? null, body);
    }
    throw new Error(`unexpected request to ${url.href}`);
  };
}

/** A chat completions stream of [chunks]. */
function chatStream(chunks: unknown[]): Response {
  const text =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
    "data: [DONE]\n\n";
  return new Response(text, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

const usage = { prompt_tokens: 100, completion_tokens: 20 };

/** A reply of [parts] of text, ending its turn. */
function says(...parts: string[]) {
  return () =>
    chatStream([
      ...parts.map((content) => ({
        choices: [{ delta: { content }, finish_reason: null }],
      })),
      { choices: [{ delta: {}, finish_reason: "stop" }] },
      { choices: [], usage },
    ]);
}

let calls = 0;
/** A reply calling the tool [name] with [args], its arguments streamed in two pieces. */
function calls_(name: string, args: unknown) {
  return () => {
    const json = JSON.stringify(args);
    const id = `call_${++calls}`;
    return chatStream([
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id,
              type: "function",
              function: { name, arguments: json.slice(0, 5) },
            }],
          },
          finish_reason: null,
        }],
      },
      {
        choices: [{
          delta: {
            tool_calls: [{ index: 0, function: { arguments: json.slice(5) } }],
          },
          finish_reason: null,
        }],
      },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      { choices: [], usage },
    ]);
  };
}

type Event = { event: string; data: Record<string, unknown> };

function parseEvents(text: string): Event[] {
  return text.split("\n\n").filter((block) => block.trim() !== "").map(
    (block) => {
      const event = block.match(/^event: (.+)$/m)?.[1] ?? "";
      const data = block.match(/^data: (.+)$/m)?.[1] ?? "null";
      return { event, data: JSON.parse(data) };
    },
  );
}

let clock = Date.UTC(2026, 10, 4);

async function send(
  fake: Fake,
  options: {
    path?: string;
    token?: string | null;
    body?: unknown;
    method?: string;
  } = {},
) {
  const logs: LogEntry[] = [];
  const handler = createHandler({
    config: readConfig((name) =>
      ({
        SUPABASE_URL,
        SUPABASE_ANON_KEY: "anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      })[name]
    ),
    fetch: fakeFetch(fake),
    log: (entry) => logs.push(entry),
    keys: {
      get: () => Promise.resolve(fake.keyed ? "sk-test" : null),
      forget: () => {},
    },
    now: () => clock++,
    random: (bytes) => new Uint8Array(bytes).fill(7),
    resolve: () => Promise.resolve(["93.184.216.34"]),
    timeout: () => new AbortController().signal,
  });
  const token = options.token === undefined ? "ada-token" : options.token;
  const response = await handler(
    new Request(`http://localhost${options.path ?? "/assistant"}`, {
      method: options.method ?? "POST",
      headers: token === null ? {} : { Authorization: `Bearer ${token}` },
      body: options.method === "GET" ? undefined : JSON.stringify(
        options.body ?? {
          messages: [{ role: "user", text: "영단어 노트 만들어 줘" }],
        },
      ),
    }),
  );
  const text = await response.text();
  const events =
    response.headers.get("Content-Type")?.startsWith("text/event-stream")
      ? parseEvents(text)
      : [];
  return {
    status: response.status,
    contentType: response.headers.get("Content-Type"),
    json: events.length === 0 && text !== "" ? JSON.parse(text) : null,
    events,
    logs,
  };
}

const ask = (text: string) => ({ messages: [{ role: "user", text }] });

const card = (front: string, back: string) => ({ front, back });

Deno.test("a message streams its text, then one usage event last, and is recorded", async () => {
  const fake = seed();
  fake.replies.push(says("안녕", "하세요!"));
  const run = await send(fake);
  assert.equal(run.status, 200);
  assert.equal(run.contentType, "text/event-stream; charset=utf-8");
  assert.deepEqual(run.events.map((e) => e.event), ["text", "text", "usage"]);
  assert.deepEqual(run.events.slice(0, 2).map((e) => e.data.delta), [
    "안녕",
    "하세요!",
  ]);
  assert.deepEqual(run.events.at(-1)!.data, {
    outcome: "ok",
    model_calls: 1,
    input_tokens: 100,
    output_tokens: 20,
    reasoning_tokens: 0,
    web_search_requests: 0,
    daily_limit: 10,
    used: 1,
  });
  assert.equal(fake.finished.length, 1);
  assert.equal(fake.finished[0]!.outcome, "ok");
  assert.equal(fake.finished[0]!.message_id, 41);
  // The provider is sent the configuration's model, prompt and the conversation.
  const request = fake.requests[0]!;
  assert.equal(request.model, "anthropic/claude-haiku-5.5");
  assert.deepEqual((request.messages as Row[])[0], {
    role: "system",
    content: "You are 말랑이.",
  });
  assert.deepEqual((request.messages as Row[])[1], {
    role: "user",
    content: "영단어 노트 만들어 줘",
  });
  assert.equal(run.logs.length, 1);
  assert.equal(run.logs[0]!.outcome, "ok");
  assert.equal(run.logs[0]!.outcome_recorded, true);
  assert.ok(
    !JSON.stringify(run.logs).includes("영단어"),
    "the log holds no message text",
  );
});

Deno.test("the tool loop stops at its call limit, against a loop the model ends itself", async () => {
  const looping = seed();
  for (let i = 0; i < MAX_MODEL_CALLS + 1; i++) {
    looping.replies.push(calls_("list_decks", {}));
  }
  const run = await send(looping);
  assert.equal(looping.requests.length, MAX_MODEL_CALLS);
  assert.equal(run.events.at(-1)!.data.outcome, "depth_limit");
  assert.equal(run.events.at(-1)!.data.model_calls, MAX_MODEL_CALLS);
  assert.equal(looping.finished[0]!.outcome, "depth_limit");

  const ending = seed();
  ending.replies.push(calls_("list_decks", {}), says("노트가 하나 있어요."));
  const control = await send(ending);
  assert.equal(ending.requests.length, 2);
  assert.equal(control.events.at(-1)!.data.outcome, "ok");
  // The read tool's answer reached the model as the tool's result.
  const answered = (ending.requests[1]!.messages as Row[]).at(-1)!;
  assert.equal(answered.role, "tool");
  assert.deepEqual(JSON.parse(String(answered.content)).decks, [{
    id: ADA_DECK,
    name: "영단어",
    card_count: 1,
  }]);
});

Deno.test("a proposal of refused cards shows nothing and tells the model why, against one shown", async () => {
  const refused = seed();
  refused.replies.push(
    calls_("propose_cards", {
      deck_id: ADA_DECK,
      groups: [{
        title: "1단원",
        format: "text",
        cards: [{ front: "" }, { blocks: [] }],
      }],
    }),
    says("다시 만들어 볼게요."),
  );
  const run = await send(refused);
  assert.deepEqual(run.events.map((e) => e.event), ["text", "usage"]);
  const result = (refused.requests[1]!.messages as Row[]).at(-1)!;
  assert.match(String(result.content), /No card could be shown/);
  assert.deepEqual(refused.writes, []);

  const shown = seed();
  shown.replies.push(
    calls_("propose_cards", {
      deck_id: ADA_DECK,
      groups: [{
        title: "1단원",
        format: "text",
        cards: [card("banana", "바나나"), card("Apple", "사과")],
      }],
    }),
    says("만들었어요."),
  );
  const control = await send(shown);
  const proposal = control.events.find((e) => e.event === "proposal")!
    .data as unknown as Proposal;
  assert.equal(proposal.kind, "cards");
  assert.deepEqual(proposal.deck, { id: ADA_DECK, name: "영단어" });
  // "Apple" matches the note's "apple" and is left out as a duplicate, as add_cards skips it.
  assert.deepEqual(proposal.groups[0]!.cards.map((c) => c.card), [
    card("banana", "바나나"),
  ]);
  assert.deepEqual(shown.writes, [], "a proposal writes nothing");
});

Deno.test("a proposal over 100 cards is refused whole, against 100", async () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => card(`word ${i}`, `뜻 ${i}`));
  const over = seed();
  over.replies.push(
    calls_("propose_deck", {
      name: "큰 노트",
      groups: [{ title: "전부", format: "text", cards: many(101) }],
    }),
    says("나눠서 만들게요."),
  );
  const run = await send(over);
  assert.equal(run.events.filter((e) => e.event === "proposal").length, 0);
  assert.match(
    String((over.requests[1]!.messages as Row[]).at(-1)!.content),
    /at most 100 cards/,
  );

  const full = seed();
  full.replies.push(
    calls_("propose_deck", {
      name: "큰 노트",
      groups: [{ title: "전부", format: "text", cards: many(100) }],
    }),
    says("만들었어요."),
  );
  const control = await send(full);
  const proposal = control.events.find((e) => e.event === "proposal")!
    .data as unknown as Proposal;
  assert.equal(proposal.groups[0]!.cards.length, 100);
  assert.deepEqual(proposal.deck, { id: null, name: "큰 노트" });
});

Deno.test("a choice is sent and ends the turn", async () => {
  const fake = seed();
  fake.replies.push(
    calls_("ask_choice", {
      prompt: "어떤 형식으로 만들까요?",
      options: ["단어", "빈칸 문장", "표", "알아서 섞어서"],
    }),
  );
  const run = await send(fake);
  assert.deepEqual(run.events.map((e) => e.event), ["choice", "usage"]);
  assert.deepEqual(run.events[0]!.data, {
    prompt: "어떤 형식으로 만들까요?",
    options: ["단어", "빈칸 문장", "표", "알아서 섞어서"],
  });
  assert.equal(fake.requests.length, 1, "no call follows the question");
  assert.equal(run.events.at(-1)!.data.outcome, "choice");
});

const PROPOSAL: Proposal = {
  id: "00000000-0000-7000-8000-0000000000f1",
  kind: "cards",
  deck: { id: ADA_DECK, name: "영단어" },
  groups: [
    {
      id: "00000000-0000-7000-8000-0000000000a1",
      title: "동물",
      format: "text",
      cards: [
        { id: "00000000-0000-7000-8000-0000000000c1", card: card("dog", "개") },
        {
          id: "00000000-0000-7000-8000-0000000000c2",
          card: card("cat", "고양이"),
        },
      ],
    },
    {
      id: "00000000-0000-7000-8000-0000000000a2",
      title: "문장",
      format: "text",
      cards: [{
        id: "00000000-0000-7000-8000-0000000000c3",
        card: card("I run", "나는 달린다"),
      }],
    },
  ],
};

Deno.test("regenerating a group remakes it alone, the other group kept as it was", async () => {
  const fake = seed();
  fake.replies.push(
    calls_("regenerate_group", {
      proposal_id: PROPOSAL.id,
      group_id: PROPOSAL.groups[1]!.id,
      format: "cloze",
      cards: [{
        blocks: [{ type: "cloze", text: "I ___ every day", answers: ["run"] }],
      }],
    }),
    says("빈칸으로 바꿨어요."),
  );
  const run = await send(fake, {
    body: {
      messages: [
        { role: "user", text: "영단어 카드 만들어 줘" },
        { role: "assistant", text: "만들었어요.", proposals: [PROPOSAL] },
        { role: "user", text: "이 부분은 빈칸으로" },
      ],
    },
  });
  // The model read the earlier proposal's ids in the conversation.
  assert.match(
    String((fake.requests[0]!.messages as Row[])[2]!.content),
    new RegExp(PROPOSAL.groups[1]!.id),
  );
  const remade = run.events.find((e) => e.event === "proposal")!
    .data as unknown as Proposal;
  assert.equal(remade.id, PROPOSAL.id);
  assert.deepEqual(remade.groups[0], PROPOSAL.groups[0]);
  assert.equal(remade.groups[1]!.id, PROPOSAL.groups[1]!.id);
  assert.equal(remade.groups[1]!.format, "cloze");
  assert.deepEqual(remade.groups[1]!.cards.map((c) => c.card), [
    { blocks: [{ type: "cloze", text: "I ___ every day", answers: ["run"] }] },
  ]);
});

Deno.test("a group of one format refuses a card without that format, against mixed", async () => {
  const fake = seed();
  fake.replies.push(
    calls_("propose_cards", {
      deck_id: ADA_DECK,
      groups: [
        { title: "빈칸", format: "cloze", cards: [card("pear", "배")] },
        { title: "섞어서", format: "mixed", cards: [card("plum", "자두")] },
      ],
    }),
    says("만들었어요."),
  );
  const run = await send(fake);
  const proposal = run.events.find((e) => e.event === "proposal")!
    .data as unknown as Proposal;
  assert.deepEqual(proposal.groups.map((g) => g.title), ["섞어서"]);
  assert.match(
    String((fake.requests[1]!.messages as Row[]).at(-1)!.content),
    /a card of a cloze group holds a cloze block/,
  );
});

Deno.test("a commit adds only the checked cards through add_cards", async () => {
  const fake = seed();
  const run = await send(fake, {
    path: "/assistant/commit",
    body: {
      proposal: PROPOSAL,
      checked: {
        [PROPOSAL.groups[0]!.id]: [PROPOSAL.groups[0]!.cards[1]!.id],
        [PROPOSAL.groups[1]!.id]: [],
      },
    },
  });
  assert.equal(run.status, 200);
  assert.deepEqual(run.json.deck, { id: ADA_DECK, name: "영단어" });
  assert.deepEqual(run.json.added.map((a: Row) => a.front), ["cat"]);
  const inserted = fake.cards.filter((c) => c.deck_id === ADA_DECK).map((c) =>
    c.card_key
  );
  assert.deepEqual(inserted, ["apple", "cat"]);
  assert.equal(run.logs[0]!.outcome, "committed");
});

Deno.test("a commit of a new note creates it with every checked card", async () => {
  const fake = seed();
  const proposal = { ...PROPOSAL, deck: { id: null, name: "동물 노트" } };
  const run = await send(fake, {
    path: "/assistant/commit",
    body: {
      proposal,
      checked: {
        [PROPOSAL.groups[0]!.id]: PROPOSAL.groups[0]!.cards.map((c) => c.id),
      },
    },
  });
  assert.equal(run.status, 200);
  assert.equal(run.json.deck.name, "동물 노트");
  const deck = fake.decks.find((d) => d.name === "동물 노트")!;
  assert.equal(deck.user_id, ADA);
  assert.deepEqual(
    fake.cards.filter((c) => c.deck_id === deck.id).map((c) => c.card_key),
    ["dog", "cat"],
  );
});

Deno.test("a commit refuses a card its group lacks and another user's note, against its own", async () => {
  const unknown = await send(seed(), {
    path: "/assistant/commit",
    body: {
      proposal: PROPOSAL,
      checked: { [PROPOSAL.groups[0]!.id]: [PROPOSAL.groups[1]!.cards[0]!.id] },
    },
  });
  assert.equal(unknown.status, 400);
  assert.match(unknown.json.message, /has no card/);

  const graces = seed();
  const theirs = await send(graces, {
    path: "/assistant/commit",
    body: {
      proposal: { ...PROPOSAL, deck: { id: GRACE_DECK, name: "Grace's" } },
      checked: { [PROPOSAL.groups[0]!.id]: [PROPOSAL.groups[0]!.cards[0]!.id] },
    },
  });
  assert.equal(theirs.status, 422);
  assert.match(theirs.json.message, /No deck of the signed-in user/);
  assert.deepEqual(graces.writes, []);

  const own = await send(seed(), {
    path: "/assistant/commit",
    body: {
      proposal: PROPOSAL,
      checked: { [PROPOSAL.groups[0]!.id]: [PROPOSAL.groups[0]!.cards[0]!.id] },
    },
  });
  assert.equal(own.status, 200);
});

Deno.test("a message past the day's limit is refused before any model call, against one under it", async () => {
  const spent = seed();
  spent.used = 10;
  const run = await send(spent);
  assert.equal(run.status, 429);
  assert.deepEqual(run.json, {
    error: "rate_limited",
    daily_limit: 10,
    used: 10,
  });
  assert.equal(spent.requests.length, 0);
  assert.equal(run.logs[0]!.outcome, "rate_limited");

  const left = seed();
  left.used = 9;
  left.replies.push(says("네"));
  const control = await send(left);
  assert.equal(control.status, 200);
  assert.equal(control.events.at(-1)!.data.used, 10);
});

Deno.test("a provider without a key is refused uncounted", async () => {
  const fake = seed();
  fake.keyed = false;
  const run = await send(fake);
  assert.equal(run.status, 503);
  assert.deepEqual(run.json, { error: "unavailable" });
  assert.equal(fake.used, 0);
});

Deno.test("citations are streamed once each", async () => {
  const fake = seed();
  fake.replies.push(() =>
    chatStream([
      {
        choices: [{
          delta: { content: "서울은 수도예요." },
          finish_reason: null,
        }],
      },
      {
        choices: [{
          delta: {
            annotations: [
              {
                type: "url_citation",
                url_citation: { url: "https://example.com/a", title: "A" },
              },
              {
                type: "url_citation",
                url_citation: { url: "https://example.com/a", title: "A" },
              },
            ],
          },
          finish_reason: "stop",
        }],
      },
      {
        choices: [],
        usage: { ...usage, server_tool_use: { web_search_requests: 1 } },
      },
    ])
  );
  const run = await send(fake);
  assert.deepEqual(
    run.events.filter((e) => e.event === "citation").map((e) => e.data),
    [
      { url: "https://example.com/a", title: "A" },
    ],
  );
  assert.equal(run.events.at(-1)!.data.web_search_requests, 1);
});

Deno.test("a failed provider call ends the stream with an error and records it", async () => {
  const fake = seed();
  fake.replies.push(() =>
    Response.json({ error: { message: "overloaded" } }, { status: 529 })
  );
  const run = await send(fake);
  assert.deepEqual(run.events.map((e) => e.event), ["error", "usage"]);
  assert.equal(run.events.at(-1)!.data.outcome, "model_error");
  assert.equal(fake.finished[0]!.outcome, "model_error");
});

Deno.test("the open note is named to the model", async () => {
  const fake = seed();
  fake.replies.push(says("네"));
  await send(fake, {
    body: { ...ask("카드 더 만들어 줘"), context: { deck_id: ADA_DECK } },
  });
  assert.match(
    String((fake.requests[0]!.messages as Row[])[0]!.content),
    /inside their note "영단어"/,
  );
});

Deno.test("requests are refused before any count: no token, a suspended user, a malformed body", async () => {
  const fake = seed();
  assert.equal((await send(fake, { token: null })).status, 401);
  assert.equal((await send(fake, { token: "forged" })).status, 401);
  assert.equal((await send(fake, { method: "GET" })).status, 405);
  assert.equal((await send(fake, { body: { messages: [] } })).status, 400);
  assert.equal(
    (await send(fake, {
      body: { messages: [{ role: "assistant", text: "hi" }] },
    })).status,
    400,
  );
  const suspended = seed();
  suspended.suspended.add(ADA);
  assert.equal((await send(suspended)).status, 403);
  assert.equal(fake.used + suspended.used, 0);
  assert.equal(fake.requests.length + suspended.requests.length, 0);
});

/** An Anthropic messages stream of [events]. */
function messagesStream(events: unknown[]): Response {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

Deno.test("a call the provider paused is sent again to go on, within the call limit", async () => {
  const fake = seed();
  fake.configuration = {
    ...fake.configuration,
    provider: "anthropic",
    model: "claude-haiku-5-5",
  };
  fake.replies.push(
    () =>
      messagesStream([
        {
          type: "message_start",
          message: { usage: { input_tokens: 10, output_tokens: 1 } },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "server_tool_use",
            id: "srv_1",
            name: "web_search",
            input: {},
          },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "pause_turn" },
          usage: {
            output_tokens: 5,
            server_tool_use: { web_search_requests: 1 },
          },
        },
        { type: "message_stop" },
      ]),
    () =>
      messagesStream([
        {
          type: "message_start",
          message: { usage: { input_tokens: 20, output_tokens: 1 } },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "찾았어요" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 7 },
        },
        { type: "message_stop" },
      ]),
  );
  const run = await send(fake);
  assert.equal(fake.requests.length, 2);
  // The paused message goes back as the last one, with no user turn after it.
  assert.equal((fake.requests[1]!.messages as Row[]).at(-1)!.role, "assistant");
  assert.deepEqual(run.events.map((e) => e.event), ["text", "usage"]);
  assert.equal(run.events.at(-1)!.data.outcome, "ok");
  assert.equal(run.events.at(-1)!.data.web_search_requests, 1);
});

Deno.test("a turn's searches are shared by its calls, the search tool dropped once they are spent", async () => {
  const fake = seed();
  fake.configuration = {
    ...fake.configuration,
    web_search: true,
    max_searches: 3,
  };
  const searched = (requests: number) => () =>
    chatStream([
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: `s${requests}`,
              function: { name: "list_decks", arguments: "{}" },
            }],
          },
          finish_reason: "tool_calls",
        }],
      },
      {
        choices: [],
        usage: { ...usage, server_tool_use: { web_search_requests: requests } },
      },
    ]);
  fake.replies.push(searched(2), searched(1), says("끝"));
  await send(fake);
  const search = (request: Row) =>
    (request.tools as Row[]).find((tool) =>
      tool.type === "openrouter:web_search"
    );
  assert.deepEqual(search(fake.requests[0]!)?.parameters, {
    engine: "exa",
    max_uses: 3,
  });
  assert.deepEqual(search(fake.requests[1]!)?.parameters, {
    engine: "exa",
    max_uses: 1,
  });
  assert.equal(search(fake.requests[2]!), undefined);
});
