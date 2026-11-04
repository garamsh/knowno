// The assistant end to end, with Supabase Auth, PostgREST, its functions, Vault and the providers
// replaced by an in-memory fake that applies row-level security's owner rule. No network.
import assert from "node:assert/strict";
import {
  createHandler,
  type LogEntry,
  MAX_BODY_BYTES,
  MAX_DESCRIBED_TURN,
  MAX_MODEL_CALLS,
  MAX_TURN_TEXT,
  MAX_TURNS,
  TURN_LIMIT_MS,
} from "./handler.ts";
import { readConfig } from "./config.ts";
import {
  ADAPTERS,
  ANTHROPIC_URL,
  MAX_OUTPUT_TOKENS,
  OPENROUTER_URL,
} from "./providers.ts";
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
  /**
   * What `begin_assistant_message` answers beyond the configuration: the day's budget, the tokens
   * charged, whether a message is running, and the messages it recorded.
   */
  budget: number | null;
  charged: number;
  running: boolean;
  begun: number;
  keyed: boolean;
  configuration: Row;
  finished: Row[];
  /** How long `finish_assistant_message` takes to answer, in milliseconds. */
  finishMs: number;
  /** The users `admin_ai_session` answers as admins, and the drafts saved. */
  admins: Set<string>;
  saved: Row[];
  /** The provider's replies in order, each given the request's body. */
  replies: ((body: Row, signal: AbortSignal) => Response)[];
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
    budget: 200_000,
    charged: 0,
    running: false,
    begun: 0,
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
    finishMs: 0,
    admins: new Set([ADA]),
    saved: [],
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
      return reply(body, init?.signal ?? new AbortController().signal);
    }
    if (url.href === `${SUPABASE_URL}/auth/v1/user`) {
      const user = TOKENS[bearer];
      return user === undefined
        ? Response.json({ error_code: "bad_jwt" }, { status: 403 })
        : Response.json({ id: user });
    }
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/)?.[1];
    if (rpc === "admin_ai_session") {
      // Called as the user, refused to one who is not an admin.
      const user = TOKENS[bearer];
      return user !== undefined && fake.admins.has(user)
        ? Response.json(true)
        : Response.json({ code: "42501" }, { status: 403 });
    }
    if (rpc !== undefined) {
      assert.equal(bearer, "service-role-key");
      switch (rpc) {
        case "save_assistant_configuration":
          fake.saved.push(body);
          return Response.json(99);
        case "assistant_effort_fits":
          // As the table has it for Claude Opus 5.5, whose thinking is always on.
          return Response.json(
            !(body.model === "claude-opus-5-5" && body.effort === "none"),
          );
        case "user_suspended":
          return Response.json(fake.suspended.has(body.user_id));
        case "provider_key":
          return Response.json(fake.keyed ? "sk-test" : null);
        case "begin_assistant_message": {
          const busy = fake.running;
          const allowed = fake.keyed && !busy &&
            (fake.budget === null || fake.charged < fake.budget);
          if (allowed) {
            fake.running = true;
            fake.begun++;
          }
          return Response.json([{
            plan: "free",
            ...fake.configuration,
            available: fake.keyed,
            token_budget: fake.budget,
            tokens_used: fake.charged,
            busy,
            allowed,
            message_id: allowed ? 41 : null,
          }]);
        }
        case "finish_assistant_message":
          if (fake.finishMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, fake.finishMs));
          }
          fake.finished.push(body);
          fake.charged += body.input_tokens + body.output_tokens;
          fake.running = false;
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

/** An OpenRouter responses stream of [events], each sent under its type. */
function responsesStream(events: Row[]): Response {
  const text =
    events.map((event) =>
      `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
    ).join("") + "data: [DONE]\n\n";
  return new Response(text, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

const usage = { input_tokens: 100, output_tokens: 20 };

/** The event ending a response of [output] items. */
const completed = (output: unknown[], used: Row = usage): Row => ({
  type: "response.completed",
  response: { status: "completed", output, usage: used },
});

const message = (text: string) => ({
  type: "message",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text, annotations: [] }],
});

/** A reply of [parts] of text, ending its turn. */
function says(...parts: string[]) {
  return () =>
    responsesStream([
      ...parts.map((delta) => ({ type: "response.output_text.delta", delta })),
      completed([message(parts.join(""))]),
    ]);
}

let calls = 0;
/** A function call of the tool [name] with [args], as a response's output item. */
function functionCall(name: string, args: unknown) {
  const n = ++calls;
  return {
    type: "function_call",
    id: `fc_${n}`,
    call_id: `call_${n}`,
    name,
    arguments: JSON.stringify(args),
  };
}

/** A reply calling the tool [name] with [args], its arguments streamed in two pieces. */
function calls_(name: string, args: unknown) {
  return () => {
    const call = functionCall(name, args);
    return responsesStream([
      { type: "response.output_item.added", item: { ...call, arguments: "" } },
      {
        type: "response.function_call_arguments.delta",
        delta: call.arguments.slice(0, 5),
      },
      {
        type: "response.function_call_arguments.delta",
        delta: call.arguments.slice(5),
      },
      completed([call]),
    ]);
  };
}

/** The input items of [request], the conversation the provider was sent. */
const input = (request: Row) => request.input as Row[];

/** What the last tool call of [request] answered the model. */
const answered = (request: Row) => String(input(request).at(-1)!.output);

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

/** The handler over [fake], logging into [logs]; [now] and [timeout] replace the clock's. */
function handlerOf(
  fake: Fake,
  logs: LogEntry[],
  clocks: { now?: () => number; timeout?: (ms: number) => AbortSignal } = {},
) {
  return createHandler({
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
    now: clocks.now ?? (() => clock++),
    random: (bytes) => new Uint8Array(bytes).fill(7),
    resolve: () => Promise.resolve(["93.184.216.34"]),
    timeout: clocks.timeout ?? (() => new AbortController().signal),
  });
}

async function send(
  fake: Fake,
  options: {
    path?: string;
    token?: string | null;
    body?: unknown;
    method?: string;
    now?: () => number;
    timeout?: (ms: number) => AbortSignal;
  } = {},
) {
  const logs: LogEntry[] = [];
  const handler = handlerOf(fake, logs, options);
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
    token_budget: 200_000,
    tokens_used: 120,
  });
  assert.equal(fake.finished.length, 1);
  assert.equal(fake.finished[0]!.outcome, "ok");
  assert.equal(fake.finished[0]!.message_id, 41);
  // The provider is sent the configuration's model, prompt and the conversation.
  const request = fake.requests[0]!;
  assert.equal(request.model, "anthropic/claude-haiku-5.5");
  assert.equal(request.instructions, "You are 말랑이.");
  assert.deepEqual(input(request), [{
    role: "user",
    content: "영단어 노트 만들어 줘",
  }]);
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
  const result = input(ending.requests[1]!).at(-1)!;
  assert.equal(result.type, "function_call_output");
  assert.deepEqual(JSON.parse(String(result.output)).decks, [{
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
  assert.match(answered(refused.requests[1]!), /No card could be shown/);
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
  assert.match(answered(over.requests[1]!), /at most 100 cards/);

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
    String(input(fake.requests[0]!)[1]!.content),
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
    answered(fake.requests[1]!),
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

Deno.test("a message with the day's token budget spent is refused before any model call, against one token left", async () => {
  const spent = seed();
  spent.charged = 200_000;
  const run = await send(spent);
  assert.equal(run.status, 429);
  assert.deepEqual(run.json, {
    error: "rate_limited",
    token_budget: 200_000,
    tokens_used: 200_000,
  });
  assert.equal(spent.requests.length, 0);
  assert.equal(run.logs[0]!.outcome, "rate_limited");

  // One token left lets a message start, and it is charged whole past the budget.
  const left = seed();
  left.charged = 199_999;
  left.replies.push(says("네"));
  const control = await send(left);
  assert.equal(control.status, 200);
  assert.equal(control.events.at(-1)!.data.tokens_used, 200_119);
  assert.equal(left.charged, 200_119);
});

Deno.test("a message while another of the user's runs is refused as busy, against one after it ended", async () => {
  const fake = seed();
  fake.running = true;
  const run = await send(fake);
  assert.equal(run.status, 429);
  assert.deepEqual(run.json, { error: "busy" });
  assert.equal(fake.requests.length, 0);
  assert.equal(run.logs[0]!.outcome, "busy");

  fake.running = false;
  fake.replies.push(says("네"));
  assert.equal((await send(fake)).status, 200);
});

Deno.test("a message is charged before the client sees its end, so the next one may start at once", async () => {
  const fake = seed();
  // A record that takes a while, as one over the network does.
  fake.finishMs = 20;
  fake.replies.push(says("네"), says("또"));
  const handler = handlerOf(fake, []);
  const request = () =>
    new Request("http://localhost/assistant", {
      method: "POST",
      headers: { Authorization: "Bearer ada-token" },
      body: JSON.stringify(ask("안녕")),
    });
  const first = await handler(request());
  const reader = first.body!.pipeThrough(new TextDecoderStream()).getReader();
  let read = "";
  while (!read.includes("event: usage")) {
    const next = await reader.read();
    assert.ok(!next.done, "the stream ended before its usage event");
    read += next.value;
  }
  // The usage event has arrived and the stream is not yet read to its end.
  const second = await handler(request());
  assert.equal(second.status, 200);
  await second.body?.cancel();
  await reader.cancel();
});

Deno.test("a provider without a key is refused uncounted", async () => {
  const fake = seed();
  fake.keyed = false;
  const run = await send(fake);
  assert.equal(run.status, 503);
  assert.deepEqual(run.json, { error: "unavailable" });
  assert.equal(fake.begun, 0);
});

Deno.test("citations are streamed once each", async () => {
  const fake = seed();
  const cited = {
    type: "response.output_text.annotation.added",
    annotation: {
      type: "url_citation",
      url: "https://example.com/a",
      title: "A",
    },
  };
  fake.replies.push(() =>
    responsesStream([
      { type: "response.output_text.delta", delta: "서울은 수도예요." },
      cited,
      cited,
      completed([message("서울은 수도예요.")], {
        ...usage,
        server_tool_use_details: { web_search_requests: 1 },
      }),
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
    String(fake.requests[0]!.instructions),
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
  assert.equal(fake.begun + suspended.begun, 0);
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
    responsesStream([
      completed([functionCall("list_decks", {})], {
        ...usage,
        server_tool_use_details: { web_search_requests: requests },
      }),
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

/**
 * A reply that streams some text and holds until [gate] opens, then completes; its call's signal
 * aborting breaks the stream off, as a real fetch's body does.
 */
function held(gate: Promise<void>) {
  return (_body: Row, signal: AbortSignal) => {
    const encoder = new TextEncoder();
    const event = (value: Row) =>
      encoder.encode(
        `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`,
      );
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(
            event({ type: "response.output_text.delta", delta: "잠시만요" }),
          );
          const aborted = new Promise<"aborted">((resolve) =>
            signal.addEventListener("abort", () => resolve("aborted"), {
              once: true,
            })
          );
          const first = await Promise.race([
            gate.then(() => "open" as const),
            aborted,
          ]);
          if (first === "aborted") {
            controller.error(signal.reason);
            return;
          }
          controller.enqueue(event(completed([message("잠시만요")])));
          controller.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  };
}

/** Resolves once [condition] holds, failing after a second of event-loop turns. */
async function until(condition: () => boolean) {
  for (let turn = 0; turn < 1000; turn++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("the condition never held");
}

Deno.test("a client that goes away ends the turn as cancelled and records what it used, against one that stays", async () => {
  const gone = seed();
  let open = () => {};
  gone.replies.push(held(new Promise((resolve) => open = resolve)));
  const logs: LogEntry[] = [];
  const response = await handlerOf(gone, logs)(
    new Request("http://localhost/assistant", {
      method: "POST",
      headers: { Authorization: "Bearer ada-token" },
      body: JSON.stringify(ask("안녕")),
    }),
  );
  assert.ok(response.body !== null);
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /event: text/);
  await reader.cancel();
  open();
  await until(() => logs.length > 0);
  assert.equal(gone.finished.length, 1);
  assert.equal(gone.finished[0]!.outcome, "cancelled");
  assert.equal(gone.finished[0]!.model_calls, 1);
  assert.equal(logs[0]!.outcome, "cancelled");
  assert.equal(logs[0]!.outcome_recorded, true);

  const stays = seed();
  stays.replies.push(held(Promise.resolve()));
  const run = await send(stays);
  assert.deepEqual(run.events.map((e) => e.event), ["text", "usage"]);
  assert.equal(stays.finished[0]!.outcome, "ok");
});

Deno.test("the turn stops at its time limit, against a call made just inside it", async () => {
  const late = seed();
  late.replies.push(calls_("list_decks", {}), says("끝"));
  // The clock reads the limit once the first call was made.
  const run = await send(late, {
    now: () => late.requests.length === 0 ? 0 : TURN_LIMIT_MS,
  });
  assert.equal(late.requests.length, 1);
  assert.equal(run.events.at(-1)!.data.outcome, "time_limit");
  assert.equal(run.events.at(-1)!.data.model_calls, 1);
  assert.equal(late.finished[0]!.outcome, "time_limit");

  const inside = seed();
  inside.replies.push(calls_("list_decks", {}), says("끝"));
  const control = await send(inside, {
    now: () => inside.requests.length === 0 ? 0 : TURN_LIMIT_MS - 1,
  });
  assert.equal(inside.requests.length, 2);
  assert.equal(control.events.at(-1)!.data.outcome, "ok");
});

Deno.test("a call the turn's time runs out on ends as time_limit, against one that fails in time", async () => {
  const run = async (outOfTime: boolean) => {
    const fake = seed();
    const timer = new AbortController();
    let called = false;
    fake.replies.push((body, signal) => {
      called = true;
      setTimeout(() =>
        timer.abort(new DOMException("timed out", "TimeoutError"))
      );
      return held(new Promise(() => {}))(body, signal);
    });
    const done = await send(fake, {
      now: () => outOfTime && called ? TURN_LIMIT_MS : 0,
      timeout: () => timer.signal,
    });
    return { done, fake };
  };
  const late = await run(true);
  assert.deepEqual(late.done.events.map((e) => e.event), ["text", "usage"]);
  assert.equal(late.done.events.at(-1)!.data.outcome, "time_limit");
  assert.equal(late.fake.finished[0]!.outcome, "time_limit");

  const failed = await run(false);
  assert.deepEqual(failed.done.events.map((e) => e.event), [
    "text",
    "error",
    "usage",
  ]);
  assert.equal(failed.done.events.at(-1)!.data.outcome, "model_error");
});

Deno.test("a reply cut at the output limit ends as cut with an error event, against one that completes", async () => {
  const fake = seed();
  fake.replies.push(() =>
    responsesStream([
      { type: "response.output_text.delta", delta: "카드를 만들" },
      {
        type: "response.incomplete",
        response: {
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [message("카드를 만들")],
          usage,
        },
      },
    ])
  );
  const run = await send(fake);
  assert.deepEqual(run.events.map((e) => e.event), ["text", "error", "usage"]);
  assert.deepEqual(run.events[1]!.data, { error: "cut" });
  assert.equal(run.events.at(-1)!.data.outcome, "cut");
  assert.equal(fake.finished[0]!.outcome, "cut");

  const whole = seed();
  whole.replies.push(says("카드를 만들었어요"));
  const control = await send(whole);
  assert.equal(control.events.at(-1)!.data.outcome, "ok");
});

Deno.test("a programming error surfaces unrecorded, against a network error ending as model_error", async () => {
  const broken = seed();
  broken.replies.push(() => {
    throw new RangeError("a defect in the function");
  });
  await assert.rejects(send(broken), RangeError);
  assert.deepEqual(broken.finished, []);

  const offline = seed();
  offline.replies.push(() => {
    throw new TypeError("error sending request");
  });
  const control = await send(offline);
  assert.equal(control.events.at(-1)!.data.outcome, "model_error");
  assert.equal(offline.finished[0]!.outcome, "model_error");
});

Deno.test("a request the adapter fails to build surfaces unrecorded, not as model_error, against fetch failing", async () => {
  const body = ADAPTERS.openrouter.body;
  let built = 0;
  Object.defineProperty(ADAPTERS.openrouter, "body", {
    value: () => {
      built++;
      throw new TypeError("a defect in the adapter");
    },
  });
  const broken = seed();
  broken.replies.push(says("네"));
  try {
    await assert.rejects(send(broken), TypeError);
  } finally {
    Object.defineProperty(ADAPTERS.openrouter, "body", { value: body });
  }
  assert.equal(built, 1);
  assert.equal(broken.replies.length, 1);
  assert.deepEqual(broken.finished, []);

  const offline = seed();
  offline.replies.push(() => {
    throw new TypeError("error sending request");
  });
  const control = await send(offline);
  assert.equal(control.events.at(-1)!.data.outcome, "model_error");
});

Deno.test("a body over 512 KiB is refused uncounted, against one at the cap", async () => {
  const padded = (bytes: number) => {
    const bare = JSON.stringify({ ...ask("안녕"), pad: "" });
    return {
      ...ask("안녕"),
      pad: "x".repeat(bytes - new TextEncoder().encode(bare).length),
    };
  };
  const over = seed();
  const run = await send(over, { body: padded(MAX_BODY_BYTES + 1) });
  assert.equal(run.status, 413);
  assert.deepEqual(run.json, { error: "too_large" });
  assert.equal(over.begun, 0);

  const at = seed();
  at.replies.push(says("네"));
  assert.equal((await send(at, { body: padded(MAX_BODY_BYTES) })).status, 200);
});

Deno.test("more than 40 turns, or a turn over 4,000 characters, is refused, against the limits", async () => {
  const turns = (n: number, text = "네") =>
    Array.from({ length: n }, (_, i) => ({
      role: (n - 1 - i) % 2 === 0 ? "user" : "assistant",
      text,
    }));
  const fake = seed();
  const many = await send(fake, { body: { messages: turns(MAX_TURNS + 1) } });
  assert.equal(many.status, 400);
  const long = await send(fake, {
    body: { messages: turns(1, "가".repeat(MAX_TURN_TEXT + 1)) },
  });
  assert.equal(long.status, 400);
  assert.equal(fake.begun, 0);

  const control = seed();
  control.replies.push(says("네"), says("네"));
  assert.equal(
    (await send(control, { body: { messages: turns(MAX_TURNS) } })).status,
    200,
  );
  assert.equal(
    (await send(control, {
      body: { messages: turns(1, "가".repeat(MAX_TURN_TEXT)) },
    })).status,
    200,
  );
});

Deno.test("a turn of the largest proposals the server shows is described shorter to fit the cap, never refused", async () => {
  const id = (kind: string, n: number) =>
    `00000000-0000-7000-8000-${kind}${String(n).padStart(11, "0")}`;
  // The largest proposal the tools make: a long note name, 20 groups of long titles, 100 cards of
  // long fronts.
  const big = (n: number, groups = 20, cards = 5): Proposal => ({
    id: id("f", n),
    kind: "cards",
    deck: { id: null, name: "노".repeat(500) },
    groups: Array.from({ length: groups }, (_, g) => ({
      id: id("a", n * 100 + g),
      title: "가".repeat(60),
      format: "text",
      cards: Array.from({ length: cards }, (_, c) => ({
        id: id("c", n * 1000 + g * 10 + c),
        card: card("f".repeat(200), "b"),
      })),
    })),
  });
  // The largest question ask_choice sends.
  const choice = {
    prompt: "어".repeat(200),
    options: Array.from({ length: 6 }, () => "옵".repeat(40)),
  };
  const told = async (proposals: Proposal[], asked: unknown = choice) => {
    const fake = seed();
    fake.replies.push(says("네"));
    const run = await send(fake, {
      body: {
        messages: [
          { role: "user", text: "카드 만들어 줘" },
          {
            role: "assistant",
            text: "가".repeat(MAX_TURN_TEXT),
            proposals,
            choice: asked,
          },
          { role: "user", text: "좋아요" },
        ],
      },
    });
    return {
      status: run.status,
      turn: fake.requests.length === 0
        ? ""
        : String(input(fake.requests[0]!)[1]!.content),
    };
  };
  const fronts = (turn: string) => turn.split("f".repeat(80)).length - 1;

  const one = await told([big(1)]);
  assert.equal(one.status, 200);
  assert.equal(
    fronts(one.turn),
    100,
    "one proposal is described with five fronts a group",
  );

  const two = await told([big(1), big(2)]);
  assert.equal(two.status, 200);
  assert.ok([...two.turn].length <= MAX_DESCRIBED_TURN);
  assert.equal(
    fronts(two.turn),
    40,
    "two are described with one front a group",
  );
  for (const proposal of [big(1), big(2)]) {
    assert.ok(two.turn.includes(proposal.id));
    for (const group of proposal.groups) assert.ok(two.turn.includes(group.id));
  }
  assert.ok(two.turn.includes(`(text, 5 cards: ${"f".repeat(80)})`));

  // Proposals too many to name each are named while they fit and the rest counted.
  const many = Array.from({ length: 30 }, (_, n) => big(n, 1, 1));
  const counted = await told(many);
  assert.equal(counted.status, 200);
  assert.ok([...counted.turn].length <= MAX_DESCRIBED_TURN);
  assert.ok(counted.turn.includes(`[proposal ${many[0]!.id} `));
  assert.match(counted.turn, /\[and \d+ more proposals\]/);
  assert.ok(counted.turn.includes(choice.prompt));

  // A question no tool sends, over the cap with the text alone, is refused uncounted.
  const forged = seed();
  const refused = await send(forged, {
    body: {
      messages: [
        { role: "user", text: "카드 만들어 줘" },
        {
          role: "assistant",
          text: "가".repeat(MAX_TURN_TEXT),
          choice: {
            prompt: "어".repeat(MAX_DESCRIBED_TURN),
            options: ["네", "아니요"],
          },
        },
        { role: "user", text: "좋아요" },
      ],
    },
  });
  assert.equal(refused.status, 400);
  assert.equal(forged.begun, 0);
});

Deno.test("Anthropic's web fetches share the turn's searches with its web searches", async () => {
  const fake = seed();
  fake.configuration = {
    ...fake.configuration,
    provider: "anthropic",
    model: "claude-haiku-5-5",
    web_search: true,
    max_searches: 3,
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
            type: "tool_use",
            id: "toolu_1",
            name: "list_decks",
            input: {},
          },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: "{}" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "tool_use" },
          usage: {
            output_tokens: 5,
            server_tool_use: { web_search_requests: 1, web_fetch_requests: 1 },
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
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 2 },
        },
        { type: "message_stop" },
      ]),
  );
  await send(fake);
  const uses = (request: Row) =>
    (request.tools as Row[]).filter((tool) =>
      tool.name === "web_search" || tool.name === "web_fetch"
    ).map((tool) => tool.max_uses);
  assert.deepEqual(uses(fake.requests[0]!), [3, 3]);
  assert.deepEqual(uses(fake.requests[1]!), [1, 1]);
});

Deno.test("the longest reply resent as history is shortened to its head and tail, never refused, against a user turn over the cap", async () => {
  // A whole turn's output at the call limit, four characters a token.
  const longest = "H" +
    "x".repeat(MAX_MODEL_CALLS * MAX_OUTPUT_TOKENS * 4 - 2) +
    "T";
  const fake = seed();
  fake.replies.push(says("네"));
  const run = await send(fake, {
    body: {
      messages: [
        { role: "user", text: "길게 설명해 줘" },
        { role: "assistant", text: longest },
        { role: "user", text: "고마워요" },
      ],
    },
  });
  assert.equal(run.status, 200);
  const turn = String(input(fake.requests[0]!)[1]!.content);
  assert.ok([...turn].length <= MAX_TURN_TEXT);
  assert.ok(turn.startsWith("Hxxx"), "the head is kept");
  assert.ok(turn.endsWith("xxxT"), "the tail is kept");
  assert.match(turn, /\[… \d+ characters left out …\]/);

  const user = seed();
  const refused = await send(user, {
    body: { messages: [{ role: "user", text: "x".repeat(MAX_TURN_TEXT + 1) }] },
  });
  assert.equal(refused.status, 400);
  assert.equal(user.begun, 0);
});

Deno.test("a call that fails is charged the tokens its provider reported before it failed", async () => {
  const fake = seed();
  fake.configuration = {
    ...fake.configuration,
    provider: "anthropic",
    model: "claude-haiku-5-5",
  };
  fake.replies.push(() =>
    messagesStream([
      {
        type: "message_start",
        message: { usage: { input_tokens: 500, output_tokens: 1 } },
      },
      { type: "error", error: { type: "overloaded_error" } },
    ])
  );
  const run = await send(fake);
  assert.equal(run.events.at(-1)!.data.outcome, "model_error");
  assert.equal(fake.finished[0]!.input_tokens, 500);
  assert.equal(fake.finished[0]!.output_tokens, 1);
  assert.equal(run.events.at(-1)!.data.tokens_used, 501);
});

/** An admin's draft request to the settings route, as the user of [token]. */
function draftRequest(fake: Fake, body: unknown, token = "ada-token") {
  return send(fake, {
    path: "/assistant/settings/configuration",
    token,
    body,
  });
}

const DRAFT = {
  plan: "pro",
  provider: "openrouter",
  model: "anthropic/claude-sonnet-5.5",
  prompt_version_id: 9,
  web_search: true,
  max_searches: 2,
  reasoning_effort: "low",
};

Deno.test("an admin's draft is saved after its check call answers, with every setting", async () => {
  const fake = seed();
  fake.replies.push(says("네"));
  const run = await draftRequest(fake, DRAFT);
  assert.equal(run.status, 200);
  assert.deepEqual(run.json, { saved: true, configuration_id: 99 });
  assert.deepEqual(fake.saved, [{
    admin_id: ADA,
    plan: "pro",
    provider: "openrouter",
    model: "anthropic/claude-sonnet-5.5",
    prompt_version_id: 9,
    web_search: true,
    max_searches: 2,
    reasoning_effort: "low",
  }]);
  // The check call is the draft's own: its model, effort and web search.
  const check = fake.requests[0]!;
  assert.equal(check.model, "anthropic/claude-sonnet-5.5");
  assert.deepEqual(check.reasoning, { effort: "low" });
  assert.ok(
    (check.tools as Row[]).some((tool) =>
      tool.type === "openrouter:web_search"
    ),
  );
  assert.equal(run.logs[0]!.route, "settings");
  assert.equal(run.logs[0]!.outcome, "saved");
});

Deno.test("a draft from a user who is not an admin is refused before any call, against an admin's", async () => {
  const fake = seed();
  const run = await draftRequest(fake, DRAFT, "grace-token");
  assert.equal(run.status, 403);
  assert.deepEqual(run.json, { error: "forbidden" });
  assert.equal(fake.requests.length, 0);
  assert.deepEqual(fake.saved, []);

  const unsigned = await draftRequest(fake, DRAFT, null as unknown as string);
  assert.equal(unsigned.status, 401);

  fake.replies.push(says("네"));
  assert.equal((await draftRequest(fake, DRAFT)).status, 200);
});

Deno.test("a draft of an invalid body is refused before any call, against a valid one", async () => {
  const fake = seed();
  for (
    const body of [
      { ...DRAFT, plan: "gold" },
      { ...DRAFT, provider: "acme" },
      { ...DRAFT, model: "no-vendor" },
      { ...DRAFT, web_search: "yes" },
      { ...DRAFT, max_searches: 11 },
      { ...DRAFT, max_searches: 0 },
      { ...DRAFT, reasoning_effort: "max" },
      { ...DRAFT, prompt_version_id: 0 },
      { ...DRAFT, reasoning_effort: undefined },
      [],
    ]
  ) {
    const run = await draftRequest(fake, body);
    assert.equal(run.status, 400, JSON.stringify(body));
    assert.deepEqual(run.json, { error: "bad_request" });
  }
  assert.equal(fake.requests.length, 0);
  assert.deepEqual(fake.saved, []);

  // Without a prompt version the draft keeps the one it had.
  fake.replies.push(says("네"));
  const kept = await draftRequest(fake, {
    ...DRAFT,
    prompt_version_id: undefined,
  });
  assert.equal(kept.status, 200);
  assert.ok(!("prompt_version_id" in fake.saved[0]!));
});

Deno.test("a draft whose check call fails saves nothing and names why, against one that answers", async () => {
  const failing = async (reply: () => Response) => {
    const fake = seed();
    fake.replies.push(reply);
    const run = await draftRequest(fake, DRAFT);
    assert.deepEqual(fake.saved, []);
    return { status: run.status, json: run.json };
  };
  assert.deepEqual(
    await failing(() => Response.json({}, { status: 401 })),
    { status: 422, json: { error: "key_refused" } },
  );
  assert.deepEqual(
    await failing(() =>
      Response.json({ error: { message: "No such model" } }, { status: 400 })
    ),
    { status: 422, json: { error: "model_not_found" } },
  );
  assert.deepEqual(
    await failing(() => Response.json({}, { status: 500 })),
    { status: 422, json: { error: "call_failed" } },
  );
  assert.deepEqual(
    await failing(() =>
      responsesStream([{ type: "response.failed", response: {} }])
    ),
    { status: 422, json: { error: "call_failed" } },
  );
  assert.deepEqual(
    await failing(() => {
      throw new TypeError("error sending request");
    }),
    { status: 422, json: { error: "call_failed" } },
  );

  const keyless = seed();
  keyless.keyed = false;
  const run = await draftRequest(keyless, DRAFT);
  assert.equal(run.status, 409);
  assert.deepEqual(run.json, { error: "no_key" });
  assert.equal(keyless.requests.length, 0);

  const answers = seed();
  answers.replies.push(says("네"));
  assert.equal((await draftRequest(answers, DRAFT)).status, 200);
  assert.equal(answers.saved.length, 1);
});

Deno.test("a draft of a model that cannot run at its effort is refused as effort_unsupported before any call, against one that can", async () => {
  const opus = {
    ...DRAFT,
    provider: "anthropic",
    model: "claude-opus-5-5",
    web_search: false,
  };
  const fake = seed();
  const run = await draftRequest(fake, { ...opus, reasoning_effort: "none" });
  assert.equal(run.status, 400);
  assert.deepEqual(run.json, { error: "effort_unsupported" });
  assert.equal(fake.requests.length, 0);
  assert.deepEqual(fake.saved, []);

  fake.replies.push(() =>
    messagesStream([
      {
        type: "message_start",
        message: { usage: { input_tokens: 10, output_tokens: 1 } },
      },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: {} },
      { type: "message_stop" },
    ])
  );
  const control = await draftRequest(fake, {
    ...opus,
    reasoning_effort: "low",
  });
  assert.equal(control.status, 200);
  assert.equal(fake.saved.length, 1);
});
