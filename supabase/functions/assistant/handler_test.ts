// The assistant end to end, with Supabase Auth, PostgREST, its functions, Storage, Vault and the
// providers replaced by an in-memory fake that applies row-level security's owner rule. No network.
import assert from "node:assert/strict";
import { cardFormSkills, FORMS } from "../_shared/card_forms.ts";
import { SEED } from "../_shared/card_forms_seed.ts";
import { type LogEntry, MAX_BODY_BYTES } from "./answer.ts";
import {
  MAX_MODEL_CALLS,
  PARAGRAPH_BREAK,
  REPLY_RULES,
  TURN_LIMIT_MS,
} from "./converse.ts";
import { createHandler } from "./handler.ts";
import { MAX_DESCRIBED_TURN, MAX_TURN_TEXT, MAX_TURNS } from "./history.ts";
import { MAX_REPLY_TEXT, MAX_REQUEST_BYTES } from "./message.ts";
import { STALE_MS } from "./poll.ts";
import { READ_PAGE } from "./photo_tools.ts";
import {
  ASSISTANT_PHOTO_ESTIMATE_TOKENS,
  READING_PROMPT,
  retryAfterSeconds,
  STEP_LIMIT_MS,
  WORK_LIMIT_MS,
} from "./worker.ts";
import { type Config, readConfig } from "./config.ts";
import {
  ADAPTERS,
  ANTHROPIC_URL,
  BYTES_PER_TOKEN,
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
  /** How many reads of a note by its id still answer that it is not there (a note gone meanwhile). */
  unreadDecks: number;
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
  /** What `card_form_skills` answers the caller: one served version of each form. */
  skills: Row[];
  /** Whether `card_form_skills` answers 500. */
  skillsDown: boolean;
  /** What `assistant_study_record` reads, each row a user's; the bodies it was called with. */
  studyDecks: Row[];
  studyMissed: Row[];
  studyCalls: Row[];
  /** The zones `assistant_study_record` refuses as Postgres does when its tz data lacks them. */
  unknownZones: Set<string>;
  /** The zones it answers a database error that is not that one, 400 as the same SQLSTATE would be. */
  brokenZones: Set<string>;
  /** The photo jobs, the photos uploaded as `{user}/{photo}`, the queue and the steps. */
  jobs: Map<string, FakeJob>;
  uploaded: Set<string>;
  /** The uploaded photos older than 24 hours. */
  aged: Set<string>;
  queue: { job: string; position: number; visible: boolean }[];
  steps: Row[];
  /** The prefixes Storage was asked to delete, and the times the worker was asked for. */
  deleted: string[];
  /** Storage refuses to delete photos, and the queue's function fails, while set. */
  storageDown: boolean;
  queueDown: boolean;
  /** Storage fails to sign a photo's address while set. */
  signDown: boolean;
  /** The bodies Storage was asked to sign addresses with, and the waits the worker asked for. */
  signed: Row[];
  waited: number[];
  /** `begin_assistant_message` answers no row, as for a plan with no configuration, while set. */
  unconfigured: boolean;
  kicks: number;
  /** The background tasks the handler started. */
  tasks: Promise<void>[];
};

type FakeJob = {
  user: string;
  status: "running" | "done" | "cancelled";
  instructions: string;
  createdAt: string;
  lastStepAt: string | null;
  cleared: boolean;
  photos: {
    position: number;
    photo_id: string;
    status: string;
    attempts: number;
    cut: boolean | null;
    reading: string | null;
  }[];
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
    skills: FORMS.map((form, index) => ({
      form,
      version_id: index + 1,
      summary: SEED[form].summary,
      text: SEED[form].text,
    })),
    skillsDown: false,
    unreadDecks: 0,
    studyDecks: [],
    studyMissed: [],
    studyCalls: [],
    unknownZones: new Set(),
    brokenZones: new Set(),
    jobs: new Map(),
    uploaded: new Set(),
    aged: new Set(),
    queue: [],
    steps: [],
    deleted: [],
    storageDown: false,
    queueDown: false,
    signDown: false,
    signed: [],
    waited: [],
    unconfigured: false,
    kicks: 0,
    tasks: [],
  };
}

/** Ends [job] as done once none of its photos is queued, as the database does. */
function endIfRead(job: FakeJob) {
  if (
    job.status === "running" &&
    job.photos.every((photo) => photo.status !== "queued")
  ) job.status = "done";
}

/** The photo-job functions, as the database answers them for the worker and the tools. */
function jobRpc(fake: Fake, rpc: string, body: Row): Response | null {
  switch (rpc) {
    case "start_assistant_job": {
      const user = String(body.user_id);
      const photos = body.photo_ids as string[];
      const outcome = !fake.keyed
        ? "unavailable"
        : fake.budget !== null && fake.charged >= fake.budget
        ? "rate_limited"
        : [...fake.jobs.values()].some((job) =>
            job.user === user && job.status === "running"
          )
        ? "busy"
        : photos.some((photo) => !fake.uploaded.has(`${user}/${photo}`))
        ? "missing_photos"
        : "started";
      if (outcome === "started") {
        const id = String(body.job_id);
        fake.jobs.set(id, {
          user,
          status: "running",
          instructions: String(body.instructions),
          createdAt: new Date(clock).toISOString(),
          lastStepAt: null,
          cleared: false,
          photos: photos.map((photo_id, index) => ({
            position: index + 1,
            photo_id,
            status: "queued",
            attempts: 0,
            cut: null,
            reading: null,
          })),
        });
        fake.queue.push(
          ...photos.map((_, index) => ({
            job: id,
            position: index + 1,
            visible: true,
          })),
        );
      }
      return Response.json([{
        outcome,
        plan: "free",
        token_budget: fake.budget,
        tokens_used: fake.charged,
      }]);
    }
    case "next_assistant_job_step": {
      if (fake.queueDown) return Response.json({}, { status: 500 });
      const message = fake.queue.find((one) => one.visible);
      if (message === undefined) {
        return Response.json([{
          outcome: "empty",
          pending: fake.queue.length,
        }]);
      }
      message.visible = false;
      const job = fake.jobs.get(message.job)!;
      const photo = job.photos[message.position - 1]!;
      photo.attempts++;
      job.lastStepAt = new Date(clock).toISOString();
      fake.steps.push({
        id: fake.steps.length + 1,
        job_id: message.job,
        position: message.position,
        outcome: null,
      });
      return Response.json([{
        outcome: "step",
        pending: null,
        step_id: fake.steps.length,
        job_id: message.job,
        user_id: job.user,
        photo_id: photo.photo_id,
        photo_position: photo.position,
        attempt: photo.attempts,
        plan: "free",
        ...fake.configuration,
        instructions: job.instructions,
      }]);
    }
    case "finish_assistant_job_step": {
      const step = fake.steps[Number(body.step_id) - 1]!;
      Object.assign(step, body);
      fake.charged += Number(body.input_tokens) + Number(body.output_tokens);
      const job = fake.jobs.get(String(step.job_id))!;
      const photo = job.photos[Number(step.position) - 1]!;
      const at = fake.queue.findIndex((one) =>
        one.job === step.job_id && one.position === step.position
      );
      if (photo.status === "queued") {
        if (body.outcome === "ok" || body.outcome === "cut") {
          photo.status = "read";
          photo.reading = String(body.reading);
          photo.cut = body.outcome === "cut";
          fake.queue.splice(at, 1);
        } else if (body.outcome === "not_sent") {
          // Given back, and hidden for its delay, which this fake does not run out.
          photo.attempts--;
        } else if (body.outcome === "unreadable" || photo.attempts >= 3) {
          photo.status = "failed";
          fake.queue.splice(at, 1);
        } else fake.queue[at]!.visible = true;
        endIfRead(job);
      }
      return Response.json([{
        photo_status: photo.status,
        job_status: job.status,
      }]);
    }
    case "cancel_assistant_job": {
      const job = fake.jobs.get(String(body.job_id));
      if (job === undefined || job.user !== body.user_id) {
        return Response.json(null);
      }
      if (job.status !== "running") return Response.json(job.status);
      for (const photo of job.photos) {
        if (photo.status === "queued") photo.status = "cancelled";
      }
      fake.queue = fake.queue.filter((one) => one.job !== body.job_id);
      job.status = "cancelled";
      return Response.json("cancelled");
    }
    case "assistant_jobs_to_clear":
      return Response.json(
        [...fake.jobs.entries()].filter(([, job]) =>
          job.status !== "running" && !job.cleared
        ).map(([job_id, job]) => ({ user_id: job.user, job_id })),
      );
    case "assistant_unread_photos": {
      const named = new Set(
        [...fake.jobs.values()].flatMap((job) =>
          job.photos.map((photo) => `${job.user}/${photo.photo_id}`)
        ),
      );
      return Response.json(
        [...fake.uploaded].filter((name) =>
          fake.aged.has(name) && !named.has(name)
        ).slice(0, 100).map((name) => ({ name })),
      );
    }
    case "mark_assistant_job_cleared": {
      const job = fake.jobs.get(String(body.job_id));
      if (job !== undefined && job.status !== "running") job.cleared = true;
      return new Response(null, { status: 204 });
    }
    case "assistant_job": {
      const job = fake.jobs.get(String(body.job_id));
      if (job === undefined || job.user !== body.user_id) {
        return Response.json([]);
      }
      return Response.json([{
        status: job.status,
        created_at: job.createdAt,
        finished_at: job.status === "running" ? null : job.createdAt,
        last_step_at: job.lastStepAt,
        photos: job.photos,
      }]);
    }
  }
  return null;
}

/** Storage's signing and deleting of the chat's photos, and the function's worker route. */
function photoStorage(fake: Fake, url: URL, method: string, body: Row) {
  const signed = url.pathname.match(
    /^\/storage\/v1\/object\/sign\/assistant-photos\/(.+)$/,
  )?.[1];
  if (signed !== undefined && method === "POST") {
    if (fake.signDown) return Response.json({}, { status: 500 });
    fake.signed.push(body);
    return fake.uploaded.has(signed)
      ? Response.json({
        signedURL: `/object/sign/assistant-photos/${signed}?token=t`,
      })
      : Response.json({ error: "not_found" }, { status: 400 });
  }
  if (
    url.pathname === "/storage/v1/object/assistant-photos" &&
    method === "DELETE"
  ) {
    if (fake.storageDown) return Response.json({}, { status: 500 });
    fake.deleted.push(...(body.prefixes as string[]));
    for (const name of body.prefixes as string[]) fake.uploaded.delete(name);
    return Response.json([]);
  }
  if (url.pathname === "/functions/v1/assistant/jobs/work") {
    fake.kicks++;
    return Response.json({ working: true }, { status: 202 });
  }
  return null;
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
  if (method === "PATCH") {
    const hit: Row[] = [];
    fake.writes.push({ method, table, body });
    for (const row of rows) {
      if (row.user_id === user && matches(row, url.searchParams)) {
        Object.assign(row, body);
        hit.push({ id: row.id });
      }
    }
    return Response.json(hit);
  }
  if (method !== "GET") {
    fake.writes.push({ method, table, body });
    return Response.json([]);
  }
  if (
    table === "decks" && fake.unreadDecks > 0 && url.searchParams.has("id")
  ) {
    fake.unreadDecks--;
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
    const stored = photoStorage(fake, url, method, body);
    if (stored !== null) {
      assert.equal(bearer, "service-role-key");
      return stored;
    }
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/)?.[1];
    if (rpc === "admin_ai_session") {
      // Called as the user, refused to one who is not an admin.
      const user = TOKENS[bearer];
      return user !== undefined && fake.admins.has(user)
        ? Response.json(true)
        : Response.json({ code: "42501" }, { status: 403 });
    }
    if (rpc === "card_form_skills") {
      // Called as the user, as the tools read.
      assert.equal(headers.get("apikey"), "anon-key");
      if (TOKENS[bearer] === undefined) {
        return Response.json({ code: "PGRST301" }, { status: 401 });
      }
      return fake.skillsDown
        ? Response.json({ code: "XX000" }, { status: 500 })
        : Response.json(fake.skills);
    }
    if (rpc === "assistant_study_record") {
      // Called as the user: the rows of that user alone, as row-level security leaves them.
      assert.equal(headers.get("apikey"), "anon-key");
      const user = TOKENS[bearer];
      if (user === undefined) {
        return Response.json({ code: "PGRST301" }, { status: 401 });
      }
      fake.studyCalls.push(body);
      if (fake.brokenZones.has(body.time_zone)) {
        return Response.json({
          code: "22023",
          message: "period_days must not be negative",
        }, { status: 400 });
      }
      if (fake.unknownZones.has(body.time_zone)) {
        return Response.json({
          code: "22023",
          message: `time zone "${body.time_zone}" not recognized`,
        }, { status: 400 });
      }
      const mine = (rows: Row[]) =>
        rows.filter((row) =>
          row.user_id === user &&
          (body.deck_id === null || row.deck_id === body.deck_id)
        ).map(({ user_id: _owner, ...row }) => row);
      return Response.json({
        decks: mine(fake.studyDecks).map(({ deck_id: _deck, ...row }) => row),
        missed: mine(fake.studyMissed),
      });
    }
    if (rpc !== undefined) {
      assert.equal(bearer, "service-role-key");
      const job = jobRpc(fake, rpc, body);
      if (job !== null) return job;
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
          if (fake.unconfigured) return Response.json([]);
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

/** A reply of [text] and then a call of the tool [name] with [args], as one model call. */
function saysThenCalls(text: string, name: string, args: unknown) {
  return () => {
    const call = functionCall(name, args);
    return responsesStream([
      { type: "response.output_text.delta", delta: text },
      { type: "response.output_item.added", item: { ...call, arguments: "" } },
      { type: "response.function_call_arguments.delta", delta: call.arguments },
      completed([message(text), call]),
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

/**
 * The handler over [fake], logging into [logs]; [now] and [timeout] replace the clock's. Waiting
 * moves the clock on, and background tasks are kept in the fake.
 */
function handlerOf(
  fake: Fake,
  logs: LogEntry[],
  clocks: {
    now?: () => number;
    timeout?: (ms: number) => AbortSignal;
    config?: Config;
  } = {},
) {
  return createHandler({
    config: clocks.config ?? readConfig((name) =>
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
    skills: cardFormSkills(() => clock),
    background: (task) => fake.tasks.push(task),
    wait: (ms) => {
      fake.waited.push(ms);
      clock += ms;
      return Promise.resolve();
    },
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
    config?: Config;
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

const JOB_ID = "0123abcd-0123-4abc-8abc-0123456789ab";

Deno.test("each route answers only its method and logs its name, a path that is none a 404", async () => {
  const routes = [
    ["/assistant", "POST", "message"],
    ["/assistant/commit", "POST", "commit"],
    ["/assistant/settings/configuration", "POST", "settings"],
    ["/assistant/jobs/work", "POST", "work"],
    [`/assistant/jobs/${JOB_ID}`, "GET", "job"],
    [`/assistant/jobs/${JOB_ID}/cancel`, "POST", "cancel"],
    // The id in either case, and the path with a trailing slash.
    [`/assistant/jobs/${JOB_ID.toUpperCase()}`, "GET", "job"],
    ["/assistant/commit/", "POST", "commit"],
  ] as const;
  for (const [path, method, route] of routes) {
    const other = method === "GET" ? "POST" : "GET";
    const wrong = await send(seed(), { path, method: other, token: null });
    assert.equal(wrong.status, 405, `${other} ${path}`);
    assert.deepEqual(wrong.logs.map((log) => [log.route, log.outcome]), [[
      route,
      "method_not_allowed",
    ]]);
    // The control: the right method reaches the route, which refuses a caller with no token.
    const right = await send(seed(), { path, method, token: null });
    assert.equal(right.status, 401, `${method} ${path}`);
    assert.equal(right.logs[0]?.route, route);
  }
  for (
    const path of [
      "/assistant/other",
      "/assistant/commit/other",
      "/assistant/jobs/not-an-id",
      `/assistant/jobs/${JOB_ID}/other`,
      "/assistant/jobs",
    ]
  ) {
    const none = await send(seed(), { path, token: null });
    assert.equal(none.status, 404, path);
    assert.deepEqual(none.logs.map((log) => [log.route, log.outcome]), [[
      null,
      "not_found",
    ]]);
  }
});

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
  assert.match(
    String(request.instructions),
    /^You are 말랑이\.\n\n# Card forms\n/,
  );
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

Deno.test("the text before a tool call is marked interim and the next text follows a paragraph break, against a turn of one call", async () => {
  const fake = seed();
  fake.replies.push(
    saysThenCalls("사진을 먼저 볼게요.", "list_decks", {}),
    saysThenCalls("덱을 찾았어요.", "list_decks", {}),
    says("다 됐어요."),
  );
  const run = await send(fake);
  assert.deepEqual(run.events.map((e) => [e.event, e.data.delta ?? null]), [
    ["text", "사진을 먼저 볼게요."],
    ["interim", null],
    ["text", PARAGRAPH_BREAK],
    ["text", "덱을 찾았어요."],
    ["interim", null],
    ["text", PARAGRAPH_BREAK],
    ["text", "다 됐어요."],
    ["usage", null],
  ]);
  assert.deepEqual(run.events[1]!.data, {});

  const single = seed();
  single.replies.push(says("안녕하세요!"));
  const control = await send(single);
  assert.deepEqual(control.events.map((e) => e.event), ["text", "usage"]);
});

Deno.test("a call with no text marks nothing, and the break follows only text that was marked", async () => {
  const fake = seed();
  fake.replies.push(
    calls_("list_decks", {}),
    saysThenCalls("찾았어요.", "list_decks", {}),
    calls_("list_decks", {}),
    says("끝."),
  );
  const run = await send(fake);
  assert.deepEqual(run.events.map((e) => e.event), [
    "text",
    "interim",
    "text",
    "text",
    "usage",
  ]);
  assert.deepEqual(run.events.slice(2, 4).map((e) => e.data.delta), [
    PARAGRAPH_BREAK,
    "끝.",
  ]);
});

Deno.test("the text before ask_choice in the ending call is the reply, not interim, against the same text before another tool", async () => {
  const fake = seed();
  fake.replies.push(saysThenCalls("형식을 골라 주세요.", "ask_choice", {
    prompt: "어떤 형식으로 만들까요?",
    options: ["단어", "표"],
  }));
  const run = await send(fake);
  assert.deepEqual(run.events.map((e) => e.event), [
    "text",
    "choice",
    "usage",
  ]);
  assert.equal(run.events.at(-1)!.data.outcome, "choice");

  // A question the tool refuses does not end the turn: its text is interim.
  const refused = seed();
  refused.replies.push(
    saysThenCalls("고르세요.", "ask_choice", {
      prompt: "?",
      options: ["하나"],
    }),
    says("알겠어요."),
  );
  const control = await send(refused);
  assert.deepEqual(control.events.map((e) => e.event), [
    "text",
    "interim",
    "text",
    "text",
    "usage",
  ]);
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
        blocks: [{ type: "cloze", text: "I {{c1::run}} every day" }],
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
    { blocks: [{ type: "cloze", text: "I {{c1::run}} every day" }] },
  ]);
});

const SENSES_CARD = {
  blocks: [{
    type: "senses",
    term: "pear",
    ask: "term",
    senses: [{ labels: [], meaning: "배", examples: [] }],
  }],
};
const CLOZE_CARD = {
  blocks: [{ type: "cloze", text: "A {{c1::plum}} is a fruit." }],
};

Deno.test("the system prompt is the configuration's prompt, then the card forms index with every form's summary", async () => {
  const fake = seed();
  fake.replies.push(says("안녕하세요!"));
  await send(fake);
  const system = String(fake.requests[0]!.instructions);
  assert.ok(system.startsWith("You are 말랑이.\n\n# Card forms\n"));
  for (const form of FORMS) {
    assert.ok(system.includes(`- **${form}** — ${SEED[form].summary}\n`), form);
  }
  assert.match(
    system,
    /Every card of a proposal group takes the group's form\.\n\n# Replies\n/,
  );
  assert.ok(system.endsWith(REPLY_RULES));
  assert.match(REPLY_RULES, /one reply a turn/);
  assert.match(REPLY_RULES, /in Markdown/);
  assert.match(REPLY_RULES, /Never name a tool, a field or an error's text/);
  // Neither the guides nor an instruction to read one: that is prompt v2's, an admin's to apply.
  assert.ok(!system.includes(SEED.table.text));
  assert.ok(!system.includes("read_card_form"));
});

Deno.test("read_card_form answers the form's served guide, the text MCP serves, and refuses a form that is none", async () => {
  const fake = seed();
  fake.skills = fake.skills.map((row) =>
    row.form === "table" ? { ...row, text: "Edited table guide." } : row
  );
  fake.replies.push(
    calls_("read_card_form", { form: "table" }),
    calls_("read_card_form", { form: "flip" }),
    says("알겠어요."),
  );
  await send(fake);
  const read = input(fake.requests[1]!).at(-1)!;
  assert.equal(read.output, "Edited table guide.");
  const refused = answered(fake.requests[2]!);
  assert.match(
    refused,
    /^form must be one of text, senses, cloze, table, image, mixed\./,
  );
  // Control: the tool knows every form the index names, each answered its own guide.
  for (const form of FORMS) {
    const each = seed();
    each.replies.push(calls_("read_card_form", { form }), says("네."));
    await send(each);
    assert.equal(answered(each.requests[1]!), SEED[form].text, form);
  }
});

Deno.test("a proposal whose group mixes forms shows nothing and names each card out of its form, against a group a form", async () => {
  const fake = seed();
  fake.replies.push(
    calls_("propose_cards", {
      deck_id: ADA_DECK,
      groups: [{
        title: "과일",
        format: "senses",
        cards: [SENSES_CARD, CLOZE_CARD],
      }],
    }),
    says("고칠게요."),
  );
  const run = await send(fake);
  assert.ok(!run.events.some((e) => e.event === "proposal"));
  const refused = input(fake.requests[1]!).at(-1)!;
  assert.match(
    String(refused.output),
    /^Nothing was shown: a group holds cards of one form, and card 1 of group 0 \(과일, senses\) is a cloze card\. Move each into a group of its form/,
  );
  assert.deepEqual(fake.writes, []);
  // Control: the same cards in a group of each form are shown.
  const split = seed();
  split.replies.push(
    calls_("propose_cards", {
      deck_id: ADA_DECK,
      groups: [
        { title: "단어", format: "senses", cards: [SENSES_CARD] },
        { title: "문장", format: "cloze", cards: [CLOZE_CARD] },
      ],
    }),
    says("만들었어요."),
  );
  const shown = (await send(split)).events.find((e) => e.event === "proposal")!
    .data as unknown as Proposal;
  assert.deepEqual(shown.groups.map((g) => [g.title, g.format]), [
    ["단어", "senses"],
    ["문장", "cloze"],
  ]);
});

Deno.test("a mixed group holds only cards that combine forms, and a text block beside one form is that form", async () => {
  const combined = {
    blocks: [
      ...SENSES_CARD.blocks,
      { type: "cloze", text: "I ate a {{c1::pear}}." },
    ],
  };
  const named = {
    blocks: [{ type: "text", front: "과일" }, ...CLOZE_CARD.blocks],
  };
  const fake = seed();
  fake.replies.push(
    calls_("propose_deck", {
      name: "과일",
      groups: [
        { title: "섞어서", format: "mixed", cards: [combined] },
        { title: "빈칸", format: "cloze", cards: [named] },
      ],
    }),
    says("만들었어요."),
  );
  const shown = (await send(fake)).events.find((e) => e.event === "proposal")!
    .data as unknown as Proposal;
  assert.deepEqual(shown.groups.map((g) => g.cards.length), [1, 1]);
  // Control: a card of one form in a mixed group is refused as mixing forms.
  const wrong = seed();
  wrong.replies.push(
    calls_("propose_deck", {
      name: "과일",
      groups: [{ title: "섞어서", format: "mixed", cards: [combined, named] }],
    }),
    says("고칠게요."),
  );
  await send(wrong);
  assert.match(
    answered(wrong.requests[1]!),
    /card 1 of group 0 \(섞어서, mixed\) is a cloze card/,
  );
});

Deno.test("propose_changes groups changes by form and refuses a group that mixes them, against the card in its form's group", async () => {
  const change = (format: string) => ({
    deck_id: ADA_DECK,
    groups: [{
      title: "고치기",
      format,
      cards: [{
        id: "00000000-0000-7000-8000-000000000c01",
        blocks: [{ type: "text", front: "apple", back: "사과 (과일)" }],
      }],
    }],
  });
  const fake = seed();
  fake.replies.push(calls_("propose_changes", change("cloze")), says("네."));
  const refused = await send(fake);
  assert.ok(!refused.events.some((e) => e.event === "proposal"));
  assert.match(
    answered(fake.requests[1]!),
    /card 0 of group 0 \(고치기, cloze\) is a text card/,
  );
  const control = seed();
  control.replies.push(calls_("propose_changes", change("text")), says("네."));
  const shown = (await send(control)).events.find((e) =>
    e.event === "proposal"
  )!.data as unknown as Proposal;
  assert.equal(shown.kind, "changes");
  assert.deepEqual(shown.groups.map((g) => [g.title, g.format]), [
    ["고치기", "text"],
  ]);
  assert.equal(
    shown.groups[0]!.cards[0]!.id,
    "00000000-0000-7000-8000-000000000c01",
  );
});

Deno.test("regenerating a group in a form its cards do not take is refused, and the proposal stays as it was", async () => {
  const fake = seed();
  fake.replies.push(
    calls_("regenerate_group", {
      proposal_id: PROPOSAL.id,
      group_id: PROPOSAL.groups[1]!.id,
      format: "senses",
      cards: [CLOZE_CARD],
    }),
    says("고칠게요."),
  );
  const run = await send(fake, {
    body: {
      messages: [
        { role: "user", text: "영단어 카드 만들어 줘" },
        { role: "assistant", text: "만들었어요.", proposals: [PROPOSAL] },
        { role: "user", text: "이 부분은 단어로" },
      ],
    },
  });
  assert.ok(!run.events.some((e) => e.event === "proposal"));
  assert.match(
    answered(fake.requests[1]!),
    /card 0 of group 0 \(문장, senses\) is a cloze card/,
  );
});

Deno.test("a message whose card forms cannot be read is refused unavailable before it starts, against one read", async () => {
  const fake = seed();
  fake.skillsDown = true;
  const run = await send(fake);
  assert.equal(run.status, 503);
  assert.deepEqual(run.json, { error: "unavailable" });
  assert.equal(fake.begun, 0);
  assert.equal(fake.requests.length, 0);
  // Control: a database missing a form's skill is refused too, rather than indexing a gap.
  const gap = seed();
  gap.skills = gap.skills.filter((row) => row.form !== "mixed");
  assert.equal((await send(gap)).status, 503);
  const read = seed();
  read.replies.push(says("안녕하세요!"));
  assert.equal((await send(read)).status, 200);
  assert.equal(read.begun, 1);
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

/** A commit of [cards] as one group of [proposal]'s deck, every one checked. */
function commitOf(
  fake: Fake,
  deck: Proposal["deck"],
  cards: Proposal["groups"][number]["cards"],
) {
  const group = { ...PROPOSAL.groups[0]!, cards };
  return send(fake, {
    path: "/assistant/commit",
    body: {
      proposal: { ...PROPOSAL, deck, groups: [group] },
      checked: { [group.id]: cards.map((c) => c.id) },
    },
  });
}

const BARE = (n: number) => ({
  id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
  card: { blocks: [] },
});
const live = (fake: Fake, name: string) =>
  fake.decks.filter((d) => d.name === name && d.deleted_at === null);

Deno.test("a commit that refuses every card answers a refusal with each reason and leaves no new note behind, against one that wrote a card", async () => {
  const fake = seed();
  const run = await commitOf(fake, { id: null, name: "빈 노트" }, [
    BARE(1),
    BARE(2),
  ]);
  assert.equal(run.status, 422);
  assert.equal(run.json.error, "refused");
  assert.match(run.json.message, /^No card was written\. Card 0: .* Card 1: /);
  assert.equal(live(fake, "빈 노트").length, 0);
  assert.equal(run.logs[0]!.outcome, "refused");
  // Control: one card written keeps the 200, and the new note.
  const kept = seed();
  const ok = await commitOf(kept, { id: null, name: "새 노트" }, [
    BARE(1),
    PROPOSAL.groups[0]!.cards[0]!,
  ]);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.added.length, 1);
  assert.equal(ok.json.refused.length, 1);
  assert.equal(live(kept, "새 노트").length, 1);
});

Deno.test("a commit that skips every card as a duplicate answers a refusal and leaves the existing note", async () => {
  const fake = seed();
  const run = await commitOf(fake, PROPOSAL.deck, [
    { id: PROPOSAL.groups[0]!.cards[0]!.id, card: card("apple", "사과") },
  ]);
  assert.equal(run.status, 422);
  assert.match(run.json.message, /^No card was written\. Card 0: /);
  assert.equal(live(fake, "영단어").length, 1);
});

Deno.test("a commit of a new note whose add_cards is refused whole leaves no note behind", async () => {
  const fake = seed();
  // The note is gone when add_cards reads it, as one deleted between the two calls.
  fake.unreadDecks = 1;
  const run = await commitOf(fake, { id: null, name: "사라진 노트" }, [
    PROPOSAL.groups[0]!.cards[0]!,
  ]);
  assert.equal(run.status, 422);
  assert.match(run.json.message, /No deck of the signed-in user/);
  assert.equal(fake.decks.some((d) => d.name === "사라진 노트"), true);
  assert.equal(live(fake, "사라진 노트").length, 0);
  assert.equal(run.logs[0]!.left_deck_id, undefined);
  // A note whose deletion is refused too is logged by id and reason, and the answer is the same.
  const stuck = seed();
  stuck.unreadDecks = 2;
  const left = await commitOf(stuck, { id: null, name: "남은 노트" }, [
    PROPOSAL.groups[0]!.cards[0]!,
  ]);
  assert.equal(left.status, 422);
  assert.match(left.json.message, /No deck of the signed-in user/);
  assert.equal(live(stuck, "남은 노트").length, 1);
  assert.equal(left.logs.length, 1);
  assert.equal(left.logs[0]!.left_deck_id, live(stuck, "남은 노트")[0]!.id);
  assert.match(left.logs[0]!.left_reason!, /No deck of the signed-in user/);
  assert.equal(JSON.stringify(left.logs[0]).includes("dog"), false);
});

Deno.test("a changes commit that updates no card answers a refusal with each reason, against one that updates a card", async () => {
  const APPLE = "00000000-0000-7000-8000-000000000c01";
  const change = (id: string) => ({
    id: "00000000-0000-7000-8000-0000000000d1",
    card: {
      id,
      blocks: [{ type: "text", front: "apple", back: "사과 (과일)" }],
    },
  });
  const changes = (fake: Fake, id: string) => {
    const group = { ...PROPOSAL.groups[0]!, cards: [change(id)] };
    return send(fake, {
      path: "/assistant/commit",
      body: {
        proposal: { ...PROPOSAL, kind: "changes", groups: [group] },
        checked: { [group.id]: [change(id).id] },
      },
    });
  };
  const missing = await changes(
    seed(),
    "00000000-0000-7000-8000-000000000c99",
  );
  assert.equal(missing.status, 422);
  assert.equal(missing.json.error, "refused");
  assert.match(missing.json.message, /^No card was written\. Card 0: /);
  const fake = seed();
  const ok = await changes(fake, APPLE);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.updated.length, 1);
  assert.equal(live(fake, "영단어").length, 1);
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

Deno.test("an assistant turn that said nothing is left out of the history and its user turns meet as one, against a user turn that said nothing refused", async () => {
  const fake = seed();
  fake.replies.push(says("네"));
  const run = await send(fake, {
    body: {
      messages: [
        { role: "user", text: "안녕" },
        { role: "assistant", text: "" },
        { role: "user", text: "다시" },
      ],
    },
  });
  assert.equal(run.status, 200);
  const sent = input(fake.requests[0]!);
  assert.deepEqual(sent.map((m) => m.role), ["user"]);
  assert.equal(sent[0]!.content, "안녕\n\n다시");
  // Control: an empty user turn is still refused, and an empty turn between replies is left out.
  const refused = await send(seed(), {
    body: {
      messages: [
        { role: "user", text: "" },
        { role: "assistant", text: "응" },
        { role: "user", text: "다시" },
      ],
    },
  });
  assert.equal(refused.status, 400);
  const kept = seed();
  kept.replies.push(says("네"));
  assert.equal(
    (await send(kept, {
      body: {
        messages: [
          { role: "user", text: "하나" },
          { role: "assistant", text: "응" },
          { role: "user", text: "둘" },
          { role: "assistant", text: "" },
          { role: "user", text: "셋" },
        ],
      },
    })).status,
    200,
  );
  assert.deepEqual(
    input(kept.requests[0]!).map((m) => m.role),
    ["user", "assistant", "user"],
  );
});

Deno.test("a history that starts with an assistant turn is sent from its first user turn, against one that starts with a user", async () => {
  const fake = seed();
  fake.replies.push(says("네"));
  const run = await send(fake, {
    body: {
      messages: [
        { role: "assistant", text: "앞의 답" },
        { role: "user", text: "물어봄" },
      ],
    },
  });
  assert.equal(run.status, 200);
  assert.deepEqual(
    input(fake.requests[0]!).map((m) => m.role),
    ["user"],
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

Deno.test("a client that goes away ends the turn as cancelled and is charged the usage its stream reports after it went, against one that stays", async () => {
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
  // The OpenRouter stream reports its usage only at its end, after the client went: it is read
  // there and charged.
  assert.equal(gone.finished[0]!.input_tokens, 100);
  assert.equal(gone.finished[0]!.output_tokens, 20);
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

Deno.test("a call that breaks off before its provider reported usage is charged its request's input as an estimate", async () => {
  const fake = seed();
  // An OpenRouter stream that breaks off after its first text, before `response.completed`.
  fake.replies.push(() =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode(
            `event: response.output_text.delta\ndata: ${
              JSON.stringify({
                type: "response.output_text.delta",
                delta: "잠시",
              })
            }\n\n`,
          ));
          controller.error(new TypeError("connection reset"));
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    )
  );
  const run = await send(fake);
  assert.equal(run.events.at(-1)!.data.outcome, "model_error");
  const sent = new TextEncoder().encode(JSON.stringify(fake.requests[0]!))
    .length;
  assert.ok(sent > 0);
  assert.equal(
    fake.finished[0]!.input_tokens,
    Math.ceil(sent / BYTES_PER_TOKEN),
  );
  assert.equal(fake.finished[0]!.output_tokens, 0);

  // A call whose provider refused it outright is charged nothing.
  const refused = seed();
  refused.replies.push(() => Response.json({}, { status: 500 }));
  await send(refused);
  assert.equal(refused.finished[0]!.input_tokens, 0);
});

Deno.test("a history of the longest replies at every turn is never refused for its size, against a body over what it may hold", async () => {
  // Every turn but the last a longest reply of three-byte characters, as the server streams it.
  const reply = "가".repeat(MAX_REPLY_TEXT);
  const messages = [
    { role: "user", text: "시작" },
    ...Array.from({ length: MAX_TURNS - 2 }, () => ({
      role: "assistant",
      text: reply,
    })),
    { role: "user", text: "고마워요" },
  ];
  const fake = seed();
  fake.replies.push(says("네"));
  const run = await send(fake, { body: { messages } });
  assert.ok(
    new TextEncoder().encode(JSON.stringify({ messages })).length >
      MAX_BODY_BYTES,
    "setup: the history is over what a request may hold before it is shortened",
  );
  assert.equal(run.status, 200);
  const turns = input(fake.requests[0]!);
  assert.equal(turns.length, MAX_TURNS);
  assert.ok(
    turns.every((turn) => [...String(turn.content)].length <= MAX_TURN_TEXT),
  );

  const over = seed();
  const refused = await send(over, {
    body: {
      messages: [{ role: "user", text: "네" }],
      pad: "x".repeat(MAX_REQUEST_BYTES),
    },
  });
  assert.equal(refused.status, 413);
  assert.equal(over.begun, 0);
});

// Photo jobs (ADR 0198).

const photoOf = (n: number) => `e0000000-0000-7000-8000-0000000000${10 + n}`;

/** Starts a job of [user]'s over [photos] in the fake, as `start_assistant_job` would. */
function jobOf(
  fake: Fake,
  user: string,
  photos: readonly string[],
  instructions = "1단원만",
): string {
  for (const photo of photos) fake.uploaded.add(`${user}/${photo}`);
  const id = `f0000000-0000-7000-8000-0000000000${10 + fake.jobs.size}`;
  jobRpc(fake, "start_assistant_job", {
    user_id: user,
    job_id: id,
    photo_ids: photos,
    instructions,
  });
  assert.equal(fake.jobs.get(id)?.status, "running", "setup: the job runs");
  return id;
}

/** A reading of whichever photo the request names, as `# photo <n>`. */
const reads = (body: Row) => {
  const n = JSON.stringify(body.input).match(/This is photo (\d+)/)?.[1];
  return says(`# photo ${n}`)();
};

/** Runs the worker route as the function asks for it, and waits for its work. */
async function runWorker(
  fake: Fake,
  options: { token?: string; now?: () => number } = {},
) {
  const run = await send(fake, {
    path: "/assistant/jobs/work",
    token: options.token ?? "service-role-key",
    body: {},
    now: options.now,
  });
  await Promise.all(fake.tasks.splice(0));
  return run;
}

Deno.test("a photo job starts over the photos the latest message attached, with the user's instructions, and the client is sent it, against a message with none", async () => {
  const fake = seed();
  const photos = [photoOf(1), photoOf(2)];
  for (const photo of photos) fake.uploaded.add(`${ADA}/${photo}`);
  fake.replies.push(
    calls_("start_photo_job", { instructions: "1단원만, 표는 표로" }),
    says("사진을 읽고 있어요."),
  );
  const run = await send(fake, {
    body: {
      messages: [{
        role: "user",
        text: "이 사진들로 노트 만들어 줘",
        photos: photos.map((photo) => photo.toUpperCase()),
      }],
    },
  });
  assert.equal(run.status, 200);
  const [id, job] = [...fake.jobs.entries()][0]!;
  assert.equal(job.user, ADA);
  assert.equal(job.instructions, "1단원만, 표는 표로");
  assert.deepEqual(job.photos.map((photo) => photo.photo_id), photos);
  assert.equal(fake.kicks, 1, "the worker is asked for");
  assert.deepEqual(run.events.find((e) => e.event === "job")?.data, {
    id,
    photos: 2,
    status: "running",
  });
  assert.match(
    String(input(fake.requests[0]!)[0]!.content),
    /\[2 photos attached\]$/,
  );
  assert.equal(JSON.parse(answered(fake.requests[1]!)).job_id, id);

  const none = seed();
  none.replies.push(calls_("start_photo_job", {}), says("사진을 보내 주세요."));
  const without = await send(none);
  assert.equal(without.status, 200);
  assert.equal(none.jobs.size, 0);
  assert.equal(none.kicks, 0);
  assert.ok(!without.events.some((e) => e.event === "job"));
  assert.match(answered(none.requests[1]!), /No photos are attached/);
});

Deno.test("a photo job is refused while another runs or the day's tokens are spent, against one that starts", async () => {
  const body = {
    messages: [{ role: "user", text: "읽어 줘", photos: [photoOf(3)] }],
  };
  const busy = seed();
  jobOf(busy, ADA, [photoOf(1)]);
  busy.uploaded.add(`${ADA}/${photoOf(3)}`);
  busy.replies.push(calls_("start_photo_job", {}), says("잠시만요."));
  await send(busy, { body });
  assert.equal(busy.jobs.size, 1);
  assert.match(answered(busy.requests[1]!), /Another photo job/);

  const spent = seed();
  spent.uploaded.add(`${ADA}/${photoOf(3)}`);
  // The message starts under the budget, and a read of another job spends the rest meanwhile.
  spent.replies.push(() => {
    spent.charged = 200_000;
    return calls_("start_photo_job", {})();
  }, says("내일 다시 해요."));
  await send(spent, { body });
  assert.equal(spent.jobs.size, 0);
  assert.match(answered(spent.requests[1]!), /tokens for today are spent/);

  const control = seed();
  control.uploaded.add(`${ADA}/${photoOf(3)}`);
  control.replies.push(calls_("start_photo_job", {}), says("읽을게요."));
  await send(control, { body });
  assert.equal(control.jobs.size, 1);
});

Deno.test("a turn's photos are 1 to 50 distinct ids, and an assistant turn's job is described to the model", async () => {
  const many = Array.from(
    { length: 51 },
    (_, n) => `e0000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
  );
  const turn = (photos: unknown) => ({
    messages: [{ role: "user", text: "읽어 줘", photos }],
  });
  for (const photos of [many, [photoOf(1), photoOf(1)], ["page.jpg"], []]) {
    const fake = seed();
    assert.equal((await send(fake, { body: turn(photos) })).status, 400);
    assert.equal(fake.begun, 0);
  }
  const fifty = seed();
  fifty.replies.push(says("네"));
  assert.equal(
    (await send(fifty, { body: turn(many.slice(0, 50)) })).status,
    200,
  );
  assert.match(
    String(input(fifty.requests[0]!)[0]!.content),
    /\[50 photos attached\]/,
  );

  const job = "f0000000-0000-7000-8000-000000000010";
  const described = seed();
  described.replies.push(says("네"));
  await send(described, {
    body: {
      messages: [
        { role: "user", text: "읽어 줘", photos: [photoOf(1)] },
        {
          role: "assistant",
          text: "읽고 있어요.",
          job: { id: job, photos: 3 },
        },
        { role: "user", text: "다 됐어?" },
      ],
    },
  });
  assert.equal(
    input(described.requests[0]!)[1]!.content,
    `읽고 있어요.\n\n[photo job ${job} started over 3 photos]`,
  );
  const misplaced = seed();
  assert.equal(
    (await send(misplaced, {
      body: {
        messages: [
          { role: "assistant", text: "네", photos: [photoOf(1)] },
          { role: "user", text: "읽어 줘" },
        ],
      },
    })).status,
    400,
  );
});

Deno.test("the worker reads each queued photo with one call of the job's model, records and charges its reading, and deletes the photos once the job is done", async () => {
  const fake = seed();
  const photos = [photoOf(1), photoOf(2)];
  const id = jobOf(fake, ADA, photos);
  fake.replies.push(reads, reads);
  const run = await runWorker(fake);
  assert.equal(run.status, 202);
  const job = fake.jobs.get(id)!;
  assert.equal(job.status, "done");
  assert.deepEqual(job.photos.map((photo) => [photo.status, photo.reading]), [
    ["read", "# photo 1"],
    ["read", "# photo 2"],
  ]);
  assert.equal(fake.requests.length, 2, "one call a photo");
  for (const request of fake.requests) {
    assert.equal(request.model, fake.configuration.model);
    assert.equal(request.instructions, READING_PROMPT);
    assert.deepEqual(request.tools, []);
    const [image, text] = input(request)[0]!.content as Row[];
    const n = String(text!.text).match(/This is photo (\d+)/)![1];
    assert.equal(
      image!.image_url,
      `${SUPABASE_URL}/storage/v1/object/sign/assistant-photos/${ADA}/${
        photos[Number(n) - 1]
      }?token=t`,
    );
    assert.match(String(text!.text), /1단원만/);
  }
  assert.equal(fake.charged, 240, "each read is charged what it used");
  assert.deepEqual(
    [...fake.deleted].sort(),
    photos.map((p) => `${ADA}/${p}`).sort(),
  );
  assert.equal(fake.kicks, 0, "an emptied queue asks for no further work");
  const steps = run.logs.filter((entry) =>
    entry.route === "work" && entry.user_id !== null
  );
  assert.deepEqual(
    steps.map((entry) => [entry.outcome, entry.outcome_recorded]),
    [["ok", true], ["ok", true]],
  );

  const refused = seed();
  jobOf(refused, ADA, [photoOf(1)]);
  const user = await runWorker(refused, { token: "ada-token" });
  assert.equal(user.status, 401);
  assert.equal(refused.requests.length, 0, "a user's token runs no work");
});

Deno.test("a read that fails after its request was sent is charged the photo estimate and retried, the photo failed on its third, and a photo Storage lacks fails unread", async () => {
  const fake = seed();
  const id = jobOf(fake, ADA, [photoOf(1)]);
  const down = (): Response => {
    throw new TypeError("the network is down");
  };
  fake.replies.push(down, down, down);
  const job = fake.jobs.get(id)!;
  // Each invocation that runs out of time asks for the next, as the function's chain does.
  for (let run = 0; run < 5 && job.status === "running"; run++) {
    await runWorker(fake);
  }
  assert.deepEqual(
    job.photos.map((photo) => [photo.status, photo.attempts]),
    [["failed", 3]],
  );
  assert.equal(job.status, "done");
  assert.deepEqual(fake.steps.map((step) => step.outcome), [
    "model_error",
    "model_error",
    "model_error",
  ]);
  assert.deepEqual(
    fake.steps.map((step) => step.input_tokens),
    [
      ASSISTANT_PHOTO_ESTIMATE_TOKENS,
      ASSISTANT_PHOTO_ESTIMATE_TOKENS,
      ASSISTANT_PHOTO_ESTIMATE_TOKENS,
    ],
    "each failed read is charged the photo estimate",
  );

  const refused = seed();
  jobOf(refused, ADA, [photoOf(1)]);
  const rejected = () => Response.json({}, { status: 429 });
  refused.replies.push(rejected, rejected, rejected);
  await runWorker(refused);
  assert.deepEqual(
    refused.steps.map((step) => [step.outcome, step.input_tokens]),
    [["model_error", 0], ["model_error", 0], ["model_error", 0]],
    "control: a request the provider refused is charged nothing",
  );

  const lacking = seed();
  const gone = jobOf(lacking, ADA, [photoOf(1)]);
  lacking.uploaded.clear();
  await runWorker(lacking);
  assert.equal(
    lacking.requests.length,
    0,
    "no model call for a photo Storage lacks",
  );
  assert.deepEqual(lacking.steps.map((step) => step.outcome), ["unreadable"]);
  assert.equal(lacking.jobs.get(gone)!.photos[0]!.status, "failed");
});

Deno.test("a provider's Retry-After on a 429 or 529 is sent with the step, in seconds or as an HTTP date, against no wait for another status, a missing or a bad header", async () => {
  const asked = async (response: () => Response) => {
    const fake = seed();
    jobOf(fake, ADA, [photoOf(1)]);
    fake.replies.push(response, response, response);
    await runWorker(fake);
    const [step] = fake.steps;
    return [step!.outcome, step!.input_tokens, step!.retry_after_seconds];
  };
  const refuse = (status: number, headers: Record<string, string>) => () =>
    Response.json({}, { status, headers });
  assert.deepEqual(
    await asked(refuse(429, { "retry-after": "45" })),
    ["model_error", 0, 45],
  );
  assert.deepEqual(
    await asked(refuse(529, { "retry-after": "7" })),
    ["model_error", 0, 7],
    "a 529 as well, charged nothing",
  );
  const [, , byDate] = await asked(() =>
    Response.json({}, {
      status: 429,
      headers: { "retry-after": new Date(clock + 90_000).toUTCString() },
    })
  );
  assert.ok(
    typeof byDate === "number" && byDate > 0 && byDate <= 92,
    `an HTTP date is the seconds until it by the worker's clock, got ${byDate}`,
  );
  assert.deepEqual(
    await asked(refuse(429, {})),
    ["model_error", 0, null],
    "control: with no header the step asks for no wait, and the 30 s and 120 s of ADR 0218 hold",
  );
  assert.deepEqual(
    await asked(refuse(429, { "retry-after": "soon" })),
    ["model_error", 0, null],
    "a header that is neither seconds nor a date is not obeyed",
  );
  assert.deepEqual(
    await asked(refuse(503, { "retry-after": "45" })),
    ["model_error", 0, null],
    "another status keeps the schedule",
  );
});

Deno.test("retryAfterSeconds reads seconds and HTTP dates, and nothing else", () => {
  const now = Date.UTC(2026, 10, 9, 12, 0, 0);
  assert.equal(retryAfterSeconds("0", now), 0);
  assert.equal(retryAfterSeconds(" 120 ", now), 120);
  assert.equal(
    retryAfterSeconds("Mon, 09 Nov 2026 12:01:30 GMT", now),
    90,
  );
  assert.equal(
    retryAfterSeconds("Mon, 09 Nov 2026 11:00:00 GMT", now),
    0,
    "a date in the past is no wait",
  );
  for (const bad of [null, "", "soon", "-5", "1.5", "99999999999"]) {
    assert.equal(retryAfterSeconds(bad, now), undefined, String(bad));
  }
});

Deno.test("a read that fails on our side before its request is sent is recorded as not sent and charged nothing, with no call", async () => {
  const keyless = seed();
  jobOf(keyless, ADA, [photoOf(1)]);
  keyless.keyed = false;
  await runWorker(keyless);
  assert.equal(keyless.requests.length, 0, "no call without a key");
  assert.deepEqual(
    keyless.steps.map((step) => [step.outcome, step.input_tokens]),
    [["not_sent", 0]],
    "a missing key",
  );

  const unsigned = seed();
  jobOf(unsigned, ADA, [photoOf(1)]);
  unsigned.signDown = true;
  await runWorker(unsigned);
  assert.equal(unsigned.requests.length, 0, "no call when signing fails");
  assert.deepEqual(
    unsigned.steps.map((step) => [step.outcome, step.input_tokens]),
    [["not_sent", 0]],
    "a signing that failed",
  );
  assert.equal(unsigned.charged, 0);
});

Deno.test("a job the database ended, by the budget or a third failed read, has its photos deleted by the next worker, and a deletion that failed is retried", async () => {
  const fake = seed();
  const photos = [photoOf(1), photoOf(2)];
  const id = jobOf(fake, ADA, photos);
  const job = fake.jobs.get(id)!;
  // What `next_assistant_job_step` does when the day's budget is spent: no worker's code runs.
  for (const photo of job.photos) photo.status = "skipped";
  fake.queue = [];
  job.status = "done";
  fake.storageDown = true;
  const down = await runWorker(fake);
  assert.deepEqual(fake.deleted, [], "setup: Storage refused the deletion");
  assert.equal(job.cleared, false, "a failed deletion is not recorded");
  assert.ok(
    down.logs.some((entry) =>
      entry.route === "work" && entry.outcome === "unavailable"
    ),
    "and reaches a log",
  );

  fake.storageDown = false;
  await runWorker(fake);
  assert.deepEqual(
    [...fake.deleted].sort(),
    photos.map((p) => `${ADA}/${p}`).sort(),
  );
  assert.equal(job.cleared, true);
  fake.deleted.length = 0;
  await runWorker(fake);
  assert.deepEqual(fake.deleted, [], "a cleared job is left alone");

  const running = seed();
  jobOf(running, ADA, [photoOf(1)]);
  running.queue.forEach((message) => message.visible = false);
  await runWorker(running);
  assert.deepEqual(running.deleted, [], "a running job keeps its photos");
});

Deno.test("the worker deletes the uploads older than 24 hours that no job names, and a failed deletion is logged and tried again", async () => {
  const fake = seed();
  const named = photoOf(1);
  const unread = photoOf(2);
  const fresh = photoOf(3);
  jobOf(fake, ADA, [named]);
  fake.queue.forEach((message) => message.visible = false);
  for (const photo of [unread, fresh]) fake.uploaded.add(`${ADA}/${photo}`);
  for (const photo of [named, unread]) fake.aged.add(`${ADA}/${photo}`);
  fake.storageDown = true;
  const down = await runWorker(fake);
  assert.deepEqual(fake.deleted, [], "setup: Storage refused the deletion");
  assert.ok(
    down.logs.some((entry) =>
      entry.route === "work" && entry.outcome === "unavailable"
    ),
    "and it reaches a log",
  );
  fake.storageDown = false;
  await runWorker(fake);
  assert.deepEqual(
    fake.deleted,
    [`${ADA}/${unread}`],
    "only the old upload no job names is deleted, not the one a job names or the fresh one",
  );
  assert.ok(fake.uploaded.has(`${ADA}/${named}`));
  assert.ok(fake.uploaded.has(`${ADA}/${fresh}`));
});

Deno.test("the photo estimate of the worker is the one the sweep charges", async () => {
  const sql = await Deno.readTextFile(
    "supabase/migrations/20261109210000_assistant_photo_charges.sql",
  );
  const held = sql.match(
    /assistant_photo_estimate_tokens\(\) returns integer[\s\S]*?select (\d+);/,
  );
  assert.ok(held, "setup: the migration holds the estimate");
  assert.equal(Number(held[1]), ASSISTANT_PHOTO_ESTIMATE_TOKENS);
});

Deno.test("a lane that fails on Supabase is logged, and the other work goes on", async () => {
  const fake = seed();
  jobOf(fake, ADA, [photoOf(1)]);
  fake.queueDown = true;
  const run = await runWorker(fake);
  assert.equal(run.status, 202);
  const failed = run.logs.filter((entry) =>
    entry.route === "work" && entry.outcome === "unavailable"
  );
  assert.equal(failed.length, 3, "each of the three lanes logs its failure");
  assert.equal(fake.kicks, 0);
});

Deno.test("the worker starts no read its time cannot hold and asks for a fresh invocation", async () => {
  const fake = seed();
  const id = jobOf(fake, ADA, [photoOf(1)]);
  let first = true;
  // The work starts at 0, and every later reading of the clock leaves no room for a read.
  const now = () => {
    if (first) {
      first = false;
      return 0;
    }
    return WORK_LIMIT_MS - STEP_LIMIT_MS + 1;
  };
  await runWorker(fake, { now });
  assert.equal(fake.requests.length, 0);
  assert.equal(fake.jobs.get(id)!.photos[0]!.status, "queued");
  assert.equal(fake.kicks, 1);
});

Deno.test("a job's poll answers each photo's status without its reading, asks for the worker when no read began for 3 minutes, and answers another user's 404", async () => {
  const fake = seed();
  const id = jobOf(fake, ADA, [photoOf(1), photoOf(2)]);
  const job = fake.jobs.get(id)!;
  job.photos[0]!.status = "read";
  job.photos[0]!.reading = "# 1단원";
  const created = Date.parse(job.createdAt);
  const fresh = await send(fake, {
    path: `/assistant/jobs/${id}`,
    method: "GET",
    now: () => created + 1000,
  });
  assert.equal(fresh.status, 200);
  assert.deepEqual(fresh.json, {
    id,
    status: "running",
    photos: [
      { position: 1, photo_id: photoOf(1), status: "read" },
      { position: 2, photo_id: photoOf(2), status: "queued" },
    ],
    read: 1,
    queued: 1,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    created_at: job.createdAt,
    finished_at: null,
  });
  assert.equal(fake.kicks, 0, "a job read recently needs no worker asked for");
  await send(fake, {
    path: `/assistant/jobs/${id}`,
    method: "GET",
    now: () => created + STALE_MS + 1,
  });
  assert.equal(fake.kicks, 1, "a stale job asks for the worker");
  const other = await send(fake, {
    path: `/assistant/jobs/${id}`,
    method: "GET",
    token: "grace-token",
  });
  assert.equal(other.status, 404);
  const posted = await send(fake, { path: `/assistant/jobs/${id}` });
  assert.equal(posted.status, 405);
});

Deno.test("a job's cancel stops its photos not yet read and deletes its photos, and answers another user's 404", async () => {
  const fake = seed();
  const id = jobOf(fake, ADA, [photoOf(1), photoOf(2)]);
  const other = await send(fake, {
    path: `/assistant/jobs/${id}/cancel`,
    token: "grace-token",
    body: {},
  });
  assert.equal(other.status, 404);
  assert.equal(fake.jobs.get(id)!.status, "running");
  const run = await send(fake, {
    path: `/assistant/jobs/${id}/cancel`,
    body: {},
  });
  assert.equal(run.status, 200);
  assert.deepEqual(run.json, { id, status: "cancelled" });
  assert.deepEqual(fake.jobs.get(id)!.photos.map((photo) => photo.status), [
    "cancelled",
    "cancelled",
  ]);
  assert.equal(fake.queue.length, 0);
  assert.deepEqual(fake.deleted, [
    `${ADA}/${photoOf(1)}`,
    `${ADA}/${photoOf(2)}`,
  ]);
});

Deno.test("read_photo_job answers a job's readings a page at a time, and cancel_photo_job cancels one, each refusing a job that is none", async () => {
  const fake = seed();
  const id = jobOf(fake, ADA, [photoOf(1), photoOf(2)]);
  const job = fake.jobs.get(id)!;
  for (const photo of job.photos) {
    photo.status = "read";
    photo.cut = false;
    photo.reading = `${photo.position}`.repeat(READ_PAGE - 10);
  }
  job.status = "done";
  fake.replies.push(
    calls_("read_photo_job", { job_id: id }),
    calls_("read_photo_job", { job_id: id, from: 2 }),
    calls_("read_photo_job", { job_id: GRACE_DECK }),
    says("다 읽었어요."),
  );
  await send(fake);
  const page = (n: number) =>
    JSON.parse(String(input(fake.requests[n]!).at(-1)!.output));
  assert.deepEqual(page(1).readings.map((r: Row) => r.photo), [1]);
  assert.equal(page(1).next_from, 2);
  assert.equal(page(1).read, 2);
  assert.deepEqual(page(2).readings.map((r: Row) => r.photo), [2]);
  assert.equal(page(2).next_from, null);
  assert.match(answered(fake.requests[3]!), /no photo job/i);

  const cancelling = seed();
  const running = jobOf(cancelling, ADA, [photoOf(1)]);
  cancelling.replies.push(
    calls_("cancel_photo_job", { job_id: running }),
    says("멈췄어요."),
  );
  await send(cancelling);
  assert.equal(cancelling.jobs.get(running)!.status, "cancelled");
  assert.deepEqual(cancelling.deleted, [`${ADA}/${photoOf(1)}`]);
});

/** A deck of the study record: [user]'s, with the counts the function answers. */
function studyDeck(user: string, id: string, name: string, answers = 4): Row {
  return {
    user_id: user,
    deck_id: id,
    id,
    name,
    new: 2,
    learning: 3,
    mastered: 1,
    due: 4,
    answers,
    known: answers === 0 ? 0 : 1,
  };
}

/** A card of the study record answered "again" [misses] times, whose front reads [text]. */
function studyCard(user: string, deck: string, n: number, text: string): Row {
  return {
    user_id: user,
    id: `00000000-0000-7000-8000-${String(n).padStart(12, "0")}`,
    deck_id: deck,
    misses: 3,
    answers: 5,
    front: [{
      type: "text",
      v: 2,
      id: `00000000-0000-7000-8000-0000000000${
        String(n % 100).padStart(2, "0")
      }`,
      payload: { front: text, back: "뜻" },
    }],
    back: [],
    template: "free",
    template_version: 2,
  };
}

Deno.test("read_study_record answers the caller's own record with each card as list_cards returns it, and none of another user's", async () => {
  const fake = seed();
  fake.studyDecks.push(
    studyDeck(ADA, ADA_DECK, "영단어"),
    studyDeck(ADA, "00000000-0000-7000-8000-0000000000d2", "빈 노트", 0),
    studyDeck(GRACE, GRACE_DECK, "Grace's"),
  );
  fake.studyMissed.push(
    {
      ...studyCard(ADA, ADA_DECK, 1, "apple"),
      id: fake.cards[0]!.id,
      front: fake.cards[0]!.front,
    },
    studyCard(GRACE, GRACE_DECK, 2, "grace's card"),
  );
  fake.replies.push(
    calls_("search_cards", { query: "apple" }),
    calls_("read_study_record", {}),
    says("정리했어요."),
  );
  await send(fake);
  const listed = JSON.parse(answered(fake.requests[1]!)).cards[0];
  assert.equal(listed.blocks[0].type, "text");
  const record = JSON.parse(answered(fake.requests[2]!));
  assert.deepEqual(
    record.decks.map((deck: Row) => [deck.name, deck.known_percent]),
    [["영단어", 25], ["빈 노트", null]],
  );
  assert.deepEqual(record.decks[0].cards, {
    new: 2,
    learning: 3,
    mastered: 1,
  });
  assert.equal(record.decks[0].due, 4);
  assert.equal(record.most_missed.length, 1);
  assert.deepEqual(record.most_missed[0].blocks, listed.blocks);
  assert.equal(record.most_missed[0].id, listed.id);
  assert.equal(record.most_missed[0].missed, 3);
  assert.ok(!JSON.stringify(record).includes("Grace"));
  assert.deepEqual(fake.studyCalls, [{
    deck_id: null,
    period_days: 30,
    time_zone: "Asia/Seoul",
  }]);

  // Control: the other user, sent the same call, reads her own record and none of Ada's.
  const grace = seed();
  grace.studyDecks.push(...fake.studyDecks);
  grace.studyMissed.push(...fake.studyMissed);
  grace.replies.push(calls_("read_study_record", {}), says("네."));
  await send(grace, { token: "grace-token" });
  const hers = JSON.parse(answered(grace.requests[1]!));
  assert.deepEqual(hers.decks.map((deck: Row) => deck.name), ["Grace's"]);
  assert.equal(hers.most_missed.length, 1);
});

Deno.test("read_study_record asks for one deck and a period, and refuses an id that is none, an unknown deck and a period out of bounds", async () => {
  const fake = seed();
  fake.studyDecks.push(studyDeck(ADA, ADA_DECK, "영단어"));
  fake.replies.push(
    calls_("read_study_record", { deck_id: ADA_DECK, period_days: 7 }),
    calls_("read_study_record", { deck_id: "not-an-id" }),
    calls_("read_study_record", { deck_id: GRACE_DECK }),
    calls_("read_study_record", { period_days: 0 }),
    calls_("read_study_record", { period_days: 366 }),
    calls_("read_study_record", { period_days: 1.5 }),
    says("끝"),
  );
  await send(fake);
  assert.equal(
    JSON.parse(answered(fake.requests[1]!)).decks[0].name,
    "영단어",
  );
  assert.match(answered(fake.requests[2]!), /^deck_id must be a deck's id/);
  assert.match(answered(fake.requests[3]!), /^No deck of the signed-in user/);
  for (const n of [4, 5, 6]) {
    assert.match(answered(fake.requests[n]!), /^period_days is a number/);
  }
  // Only the first and the unknown deck's calls reached the database.
  assert.deepEqual(fake.studyCalls, [
    { deck_id: ADA_DECK, period_days: 7, time_zone: "Asia/Seoul" },
    { deck_id: GRACE_DECK, period_days: 30, time_zone: "Asia/Seoul" },
  ]);
});

Deno.test("read_study_record keeps its answer under a page, cutting the least missed cards and counting them, against a record that fits", async () => {
  const big = seed();
  big.studyDecks.push(studyDeck(ADA, ADA_DECK, "영단어"));
  for (let n = 1; n <= 50; n++) {
    big.studyMissed.push(studyCard(ADA, ADA_DECK, n, `${n} `.repeat(600)));
  }
  big.replies.push(calls_("read_study_record", {}), says("많네요."));
  await send(big);
  const cut = JSON.parse(answered(big.requests[1]!));
  assert.ok(answered(big.requests[1]!).length <= READ_PAGE);
  assert.ok(cut.most_missed_cut > 0);
  assert.equal(cut.most_missed.length + cut.most_missed_cut, 50);
  assert.equal(cut.most_missed[0].id, big.studyMissed[0]!.id);

  const small = seed();
  small.studyDecks.push(studyDeck(ADA, ADA_DECK, "영단어"));
  for (let n = 1; n <= 50; n++) {
    small.studyMissed.push(studyCard(ADA, ADA_DECK, n, `card ${n}`));
  }
  small.replies.push(calls_("read_study_record", {}), says("네."));
  await send(small);
  const whole = JSON.parse(answered(small.requests[1]!));
  assert.equal(whole.most_missed.length, 50);
  assert.equal(whole.most_missed_cut, 0);
});

Deno.test("read_study_record counts the study day in the zone the message names, and in Asia/Seoul when it names none", async () => {
  const named = seed();
  named.replies.push(calls_("read_study_record", {}), says("네."));
  const run = await send(named, {
    body: { ...ask("틀린 것만"), context: { time_zone: "America/New_York" } },
  });
  assert.equal(run.status, 200);
  assert.deepEqual(named.studyCalls.map((call) => call.time_zone), [
    "America/New_York",
  ]);

  // Control: the same message without a zone is counted in Seoul's, with the note open as before.
  const none = seed();
  none.replies.push(calls_("read_study_record", {}), says("네."));
  await send(none, {
    body: { ...ask("틀린 것만"), context: { deck_id: ADA_DECK } },
  });
  assert.deepEqual(none.studyCalls.map((call) => call.time_zone), [
    "Asia/Seoul",
  ]);

  // Both in one context, the zone spelled in another case and read as the runtime spells it.
  const both = seed();
  both.replies.push(calls_("read_study_record", {}), says("네."));
  await send(both, {
    body: {
      ...ask("틀린 것만"),
      context: { deck_id: ADA_DECK, time_zone: "europe/london" },
    },
  });
  assert.deepEqual(both.studyCalls.map((call) => call.time_zone), [
    "Europe/London",
  ]);
});

Deno.test("a message whose time zone is no IANA name is refused before any count, against a valid one", async () => {
  const fake = seed();
  for (
    const time_zone of [
      "KST",
      "+09:00",
      "Asia/Seoul; drop table",
      "",
      5,
      null,
    ]
  ) {
    const run = await send(fake, {
      body: { ...ask("안녕"), context: { time_zone } },
    });
    assert.equal(run.status, 400, JSON.stringify(time_zone));
    assert.deepEqual(run.json, { error: "bad_request" });
  }
  assert.equal(fake.begun, 0);
  assert.equal(fake.requests.length, 0);

  fake.replies.push(says("네"));
  const valid = await send(fake, {
    body: { ...ask("안녕"), context: { time_zone: "Asia/Seoul" } },
  });
  assert.equal(valid.status, 200);
});

Deno.test("a zone Intl does not know is read as absent, the message answered and the study day counted in Asia/Seoul, against a known zone", async () => {
  for (const unknown of ["Etc/Unknown", "Mars/Phobos"]) {
    const fake = seed();
    fake.replies.push(calls_("read_study_record", {}), says("네."));
    const run = await send(fake, {
      body: { ...ask("틀린 것만"), context: { time_zone: unknown } },
    });
    assert.equal(run.status, 200, unknown);
    assert.deepEqual(fake.studyCalls.map((call) => call.time_zone), [
      "Asia/Seoul",
    ], unknown);
  }

  // Control: a zone Intl knows is counted in.
  const known = seed();
  known.replies.push(calls_("read_study_record", {}), says("네."));
  await send(known, {
    body: { ...ask("틀린 것만"), context: { time_zone: "America/Denver" } },
  });
  assert.deepEqual(known.studyCalls.map((call) => call.time_zone), [
    "America/Denver",
  ]);
});

Deno.test("a zone Intl knows and Postgres does not is read again in Asia/Seoul, and any other database refusal is not, against a zone both know", async () => {
  const fake = seed();
  fake.unknownZones.add("America/Denver");
  fake.studyDecks.push(studyDeck(ADA, ADA_DECK, "영단어"));
  fake.replies.push(calls_("read_study_record", {}), says("네."));
  await send(fake, {
    body: { ...ask("틀린 것만"), context: { time_zone: "America/Denver" } },
  });
  assert.deepEqual(fake.studyCalls.map((call) => call.time_zone), [
    "America/Denver",
    "Asia/Seoul",
  ]);
  assert.equal(
    JSON.parse(answered(fake.requests[1]!)).decks[0].name,
    "영단어",
  );

  // Control: a zone the database knows is asked once.
  const own = seed();
  own.studyDecks.push(studyDeck(ADA, ADA_DECK, "영단어"));
  own.replies.push(calls_("read_study_record", {}), says("네."));
  await send(own, {
    body: { ...ask("틀린 것만"), context: { time_zone: "Europe/Paris" } },
  });
  assert.deepEqual(own.studyCalls.map((call) => call.time_zone), [
    "Europe/Paris",
  ]);

  // Another refusal of the database, even of the same SQLSTATE, is not a zone it does not know.
  const broken = seed();
  broken.brokenZones.add("America/Denver");
  broken.replies.push(calls_("read_study_record", {}), says("네."));
  await send(broken, {
    body: { ...ask("틀린 것만"), context: { time_zone: "America/Denver" } },
  });
  assert.deepEqual(broken.studyCalls.map((call) => call.time_zone), [
    "America/Denver",
  ]);
  assert.match(answered(broken.requests[1]!), /did not answer/);

  // Control: no fallback when no zone was named, so Seoul refused is the server not answering.
  const seoul = seed();
  seoul.unknownZones.add("Asia/Seoul");
  seoul.replies.push(calls_("read_study_record", {}), says("네."));
  await send(seoul);
  assert.deepEqual(seoul.studyCalls.map((call) => call.time_zone), [
    "Asia/Seoul",
  ]);
  assert.match(answered(seoul.requests[1]!), /did not answer/);
});

Deno.test("a commit writes a proposed cloze as version 2 and a proposed text card as version 3, the marks in it kept", async () => {
  const proposal: Proposal = {
    ...PROPOSAL,
    groups: [{
      id: PROPOSAL.groups[0]!.id,
      title: "섞어서",
      format: "text",
      cards: [
        {
          id: "00000000-0000-7000-8000-0000000000c4",
          card: {
            blocks: [{ type: "cloze", text: "I {{c1::run}} daily" }],
          },
        },
        {
          id: "00000000-0000-7000-8000-0000000000c5",
          card: {
            blocks: [{ type: "text", front: "pear", back: "**배**\n- 과일" }],
          },
        },
      ],
    }],
  };
  const fake = seed();
  const run = await send(fake, {
    path: "/assistant/commit",
    body: {
      proposal,
      checked: {
        [proposal.groups[0]!.id]: proposal.groups[0]!.cards.map((c) => c.id),
      },
    },
  });
  assert.equal(run.status, 200);
  const stored = fake.cards.filter((c) => c.deck_id === ADA_DECK).flatMap((c) =>
    (c.front as Row[]).map(({ type, v, payload }) => ({ type, v, payload }))
  ).filter(({ payload }) => (payload as Row).front !== "apple");
  assert.deepEqual(stored, [
    { type: "cloze", v: 2, payload: { text: "I {{c1::run}} daily" } },
    {
      type: "text",
      v: 3,
      payload: { front: "pear", back: "**배**\n- 과일" },
    },
  ]);
});

/** What a model's reply holds: a mark, a list and an Anki cloze, each in the form the markup stores. */
const MARKED = {
  note: "**광합성**\n- 빛\n- 물",
  cloze: "물은 {{c1::수소}}와 {{c2::산소}}로 이뤄져요.",
};

/** The blocks of every card [fake] holds beyond those [before] names. */
const writtenBlocks = (fake: Fake, before: ReadonlySet<unknown>) =>
  fake.cards.filter((c) => !before.has(c.id)).flatMap((c) =>
    (c.front as Row[]).map(({ type, v, payload }) => ({ type, v, payload }))
  );

/** Commits [proposal] as the app's 만들기 does, every card checked. */
async function commitAll(fake: Fake, proposal: Proposal) {
  const run = await send(fake, {
    path: "/assistant/commit",
    body: {
      proposal,
      checked: Object.fromEntries(
        proposal.groups.map((g) => [g.id, g.cards.map((c) => c.id)]),
      ),
    },
  });
  assert.equal(run.status, 200);
}

const MARKED_PROPOSAL = () =>
  calls_("propose_deck", {
    name: "광합성",
    groups: [
      {
        title: "개념",
        format: "text",
        cards: [{
          blocks: [{
            type: "text",
            front: "식물의 양분 만들기",
            back: MARKED.note,
          }],
        }],
      },
      {
        title: "빈칸",
        format: "cloze",
        cards: [{ blocks: [{ type: "cloze", text: MARKED.cloze }] }],
      },
    ],
  });

Deno.test("a chat reply holding a mark, a list and an Anki cloze is proposed and, committed, stored as text version 3 and cloze version 2", async () => {
  const fake = seed();
  const before = new Set(fake.cards.map((c) => c.id));
  fake.replies.push(MARKED_PROPOSAL(), says("만들었어요."));
  const run = await send(fake);
  const proposal = run.events.find((e) => e.event === "proposal")!
    .data as unknown as Proposal;
  await commitAll(fake, proposal);
  assert.deepEqual(
    writtenBlocks(fake, before).sort((a, b) =>
      String(a.type).localeCompare(String(b.type))
    ),
    [
      { type: "cloze", v: 2, payload: { text: MARKED.cloze } },
      {
        type: "text",
        v: 3,
        payload: { front: "식물의 양분 만들기", back: MARKED.note },
      },
    ],
  );
});

Deno.test("a photo job's reading holding a mark, a list and an Anki cloze reaches the chat whole and the cards made from it are stored as text version 3 and cloze version 2", async () => {
  const fake = seed();
  const before = new Set(fake.cards.map((c) => c.id));
  const id = jobOf(fake, ADA, [photoOf(1)]);
  const reading = `# 광합성\n${MARKED.note}\n${MARKED.cloze}`;
  fake.replies.push(() => says(reading)());
  await runWorker(fake);
  assert.equal(fake.jobs.get(id)!.photos[0]!.reading, reading);
  fake.replies.push(
    calls_("read_photo_job", { job_id: id }),
    MARKED_PROPOSAL(),
    says("만들었어요."),
  );
  const run = await send(fake);
  const read = JSON.parse(String(input(fake.requests.at(-2)!).at(-1)!.output));
  assert.equal(read.readings[0].text, reading);
  const proposal = run.events.find((e) => e.event === "proposal")!
    .data as unknown as Proposal;
  await commitAll(fake, proposal);
  assert.deepEqual(
    writtenBlocks(fake, before).sort((a, b) =>
      String(a.type).localeCompare(String(b.type))
    ),
    [
      { type: "cloze", v: 2, payload: { text: MARKED.cloze } },
      {
        type: "text",
        v: 3,
        payload: { front: "식물의 양분 만들기", back: MARKED.note },
      },
    ],
  );
});

const THREE_KINGDOMS = {
  columns: ["구분", "고구려", "백제", "신라"],
  rows: [
    ["수도", "평양", "사비", "금성"],
    ["중앙 관제", "대대로", "6좌평", "상대등"],
    ["귀족 회의", "제가 회의", "정사암 회의", "화백 회의"],
    ["지방 행정", "5부", "5방", "5주"],
    ["특수 행정 구역", "-", "22담로", "2소경"],
    ["군사 조직", "대모달", "방령", "서당"],
    ["관등", "10여 관등", "16관등", "17관등"],
  ],
};
const tableCard = (extra: Record<string, unknown>) => ({
  blocks: [{ type: "table", ...THREE_KINGDOMS, ...extra }],
});

Deno.test("a table read from a photo is shown as one table group, and an invalid shape is refused with the group, card, field and form to send (#823)", async () => {
  const propose = async (groups: unknown) => {
    const fake = seed();
    fake.replies.push(
      calls_("propose_cards", { deck_id: ADA_DECK, groups }),
      says("끝"),
    );
    const run = await send(fake);
    // The refused cards reach the model as JSON, so a quote in a sentence is escaped there.
    return { run, told: answered(fake.requests[1]!).replaceAll('\\"', '"') };
  };
  const group = (card: unknown) => [{
    title: "삼국 통치 체제",
    format: "table",
    cards: [card],
  }];
  // The 4 x 7 table with its `-` cell, blanks on cells of text and on the `-` cell.
  const { run } = await propose(group(tableCard({
    blanks: [{ row: 0, column: 1 }, { row: 4, column: 1 }, {
      row: 6,
      column: 3,
    }],
  })));
  const shown = run.events.find((e) => e.event === "proposal")!
    .data as unknown as Proposal;
  assert.deepEqual(shown.groups.map((g) => [g.format, g.cards.length]), [
    ["table", 1],
  ]);

  const refused: [string, unknown, RegExp][] = [
    [
      "no blanks",
      group(tableCard({})),
      /groups\[0\]\.cards\[0\]: block 0: a table needs blanks.*"blanks":\[\{"row":0,"column":1\}\]/,
    ],
    [
      "a block as the card",
      group({
        type: "table",
        ...THREE_KINGDOMS,
        blanks: [{ row: 0, column: 1 }],
      }),
      /groups\[0\]\.cards\[0\]: a card is \{"blocks":\[\.\.\.\]\}.*type table/,
    ],
    [
      "a short row",
      group(tableCard({
        rows: [...THREE_KINGDOMS.rows.slice(0, 6), ["관등", "10여 관등"]],
        blanks: [{ row: 0, column: 1 }],
      })),
      /block 0: a table needs every row to be a list of 4 texts, one per column, and rows\[6\] is 2 texts/,
    ],
    [
      "a blank outside the table",
      group(tableCard({ blanks: [{ row: 7, column: 1 }] })),
      /inside the table's 7 rows and 4 columns, and blanks\[0\] \(row 7, column 1\) is outside/,
    ],
    [
      "a blank on an empty cell",
      group(tableCard({
        rows: THREE_KINGDOMS.rows.map((row) =>
          row.map((c) => c === "-" ? "" : c)
        ),
        blanks: [{ row: 4, column: 1 }],
      })),
      /blanks\[0\] \(row 4, column 1\) is an empty cell/,
    ],
    [
      "a span past its cell's text",
      group(tableCard({ spans: [{ row: 0, column: 1, start: 0, end: 9 }] })),
      /groups\[0\]\.cards\[0\]: block 0: a table needs each span to run from start to end inside its cell's text of 2 units, and spans\[0\] runs 0 to 9/,
    ],
    [
      "a span in a blank cell",
      group(tableCard({
        blanks: [{ row: 0, column: 1 }],
        spans: [{ row: 0, column: 1, start: 0, end: 1 }],
      })),
      /spans\[0\] is in the blank at row 0, column 1/,
    ],
    [
      "groups as a JSON string",
      JSON.stringify(group(tableCard({ blanks: [{ row: 0, column: 1 }] }))),
      /^groups is text, and must be a list.*\{"title":"1단원","format":"text","cards":\[\.\.\.\]\}/,
    ],
    [
      "a format that is no form",
      [{ title: "삼국", format: "표", cards: [tableCard({})] }],
      /^groups\[0\]\.format must be one of text, senses, cloze, table, image, mixed/,
    ],
    [
      "a group without cards",
      [{ title: "삼국", format: "table" }],
      /^groups\[0\]\.cards must be a list of at least one card/,
    ],
  ];
  for (const [name, groups, expected] of refused) {
    const { run, told } = await propose(groups);
    assert.ok(!run.events.some((e) => e.event === "proposal"), name);
    assert.match(told, expected, name);
  }
});

const ENV: Record<string, string> = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

Deno.test("a request is refused not_configured, uncounted, while any platform variable is missing, against all three set", async () => {
  for (const missing of Object.keys(ENV)) {
    const fake = seed();
    const config = readConfig((name) => name === missing ? "" : ENV[name]);
    for (const path of ["/assistant", "/assistant/commit"]) {
      const run = await send(fake, { path, config });
      assert.equal(run.status, 503, `${missing} missing on ${path}`);
      assert.deepEqual(run.json, { error: "not_configured" });
    }
    assert.equal(fake.begun, 0);
    assert.equal(fake.requests.length, 0);
  }
  const set = seed();
  set.replies.push(says("네"));
  const run = await send(set, { config: readConfig((name) => ENV[name]) });
  assert.equal(run.status, 200);
});

Deno.test("a message is refused not_configured and uncounted for a plan with no configuration, against the plan with one", async () => {
  const none = seed();
  none.unconfigured = true;
  const run = await send(none);
  assert.equal(run.status, 503);
  assert.deepEqual(run.json, { error: "not_configured" });
  assert.equal(none.begun, 0);
  assert.equal(none.requests.length, 0);

  const some = seed();
  some.replies.push(says("네"));
  assert.equal((await send(some)).status, 200);
});

Deno.test("a commit body over 512 KiB is refused too_large and writes nothing, against one at the cap", async () => {
  const padded = (bytes: number) => {
    const body = {
      proposal: PROPOSAL,
      checked: { [PROPOSAL.groups[0]!.id]: [PROPOSAL.groups[0]!.cards[1]!.id] },
    };
    const bare = JSON.stringify({ ...body, pad: "" });
    return {
      ...body,
      pad: "x".repeat(bytes - new TextEncoder().encode(bare).length),
    };
  };
  const over = seed();
  const run = await send(over, {
    path: "/assistant/commit",
    body: padded(512 * 1024 + 1),
  });
  assert.equal(run.status, 413);
  assert.deepEqual(run.json, { error: "too_large" });
  assert.deepEqual(over.writes, []);

  const at = seed();
  const control = await send(at, {
    path: "/assistant/commit",
    body: padded(512 * 1024),
  });
  assert.equal(control.status, 200);
  assert.deepEqual(control.json.added.map((a: Row) => a.front), ["cat"]);
});

Deno.test("ask_choice takes 2 to 6 options, a prompt of at most 200 and an option of at most 40 characters, each against the value just inside", async () => {
  const text = (n: number) => "가".repeat(n);
  const options = (n: number, length = 1) =>
    Array.from({ length: n }, (_, i) => `${i}${text(length - 1)}`);
  const choose = async (args: Row) => {
    const fake = seed();
    fake.replies.push(calls_("ask_choice", args), says("다시 물을게요."));
    const run = await send(fake);
    const shown = run.events.some((e) => e.event === "choice");
    if (!shown) assert.match(answered(fake.requests[1]!), /ask_choice takes/);
    return shown;
  };
  const fits = { prompt: "고르세요", options: options(2) };
  assert.equal(await choose(fits), true, "setup: the choice is shown");
  assert.equal(await choose({ ...fits, options: options(1) }), false);
  assert.equal(await choose({ ...fits, options: options(6) }), true);
  assert.equal(await choose({ ...fits, options: options(7) }), false);
  assert.equal(await choose({ ...fits, prompt: text(200) }), true);
  assert.equal(await choose({ ...fits, prompt: text(201) }), false);
  assert.equal(await choose({ ...fits, options: options(2, 40) }), true);
  assert.equal(await choose({ ...fits, options: options(2, 41) }), false);
});

Deno.test("a proposal holds 1 to 20 groups of a title of at most 60 characters, each against the value just inside", async () => {
  const group = (title: string) => ({
    title,
    format: "text",
    cards: [card("word", "뜻")],
  });
  const propose = async (groups: unknown) => {
    const fake = seed();
    fake.replies.push(
      calls_("propose_deck", { name: "노트", groups }),
      says("다시 만들게요."),
    );
    const run = await send(fake);
    const shown = run.events.some((e) => e.event === "proposal");
    if (!shown) assert.match(answered(fake.requests[1]!), /groups/);
    return shown;
  };
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => group(`${i + 1}단원`));
  assert.equal(await propose(many(1)), true, "setup: the proposal is shown");
  assert.equal(await propose([]), false);
  assert.equal(await propose(many(20)), true);
  assert.equal(await propose(many(21)), false);
  assert.equal(await propose([group("가".repeat(60))]), true);
  assert.equal(await propose([group("가".repeat(61))]), false);
});

Deno.test("start_photo_job refuses instructions over 4,000 characters, against 4,000", async () => {
  const start = async (instructions: string) => {
    const fake = seed();
    fake.uploaded.add(`${ADA}/${photoOf(1)}`);
    fake.replies.push(
      calls_("start_photo_job", { instructions }),
      says("읽고 있어요."),
    );
    await send(fake, {
      body: {
        messages: [{ role: "user", text: "읽어 줘", photos: [photoOf(1)] }],
      },
    });
    return fake;
  };
  const at = await start("가".repeat(4000));
  assert.equal(at.jobs.size, 1, "setup: 4,000 characters start a job");
  assert.equal([...at.jobs.values()][0]!.instructions.length, 4000);
  const over = await start("가".repeat(4001));
  assert.equal(over.jobs.size, 0);
  assert.match(answered(over.requests[1]!), /at most 4000 characters/);
});

Deno.test("a photo's address is signed for 600 seconds", async () => {
  const fake = seed();
  jobOf(fake, ADA, [photoOf(1)]);
  fake.replies.push(reads);
  await runWorker(fake);
  assert.equal(fake.requests.length, 1, "setup: the photo was read");
  assert.deepEqual(fake.signed, [{ expiresIn: 600 }]);
});

Deno.test("a photo's reading is cut at 50,000 characters, against one of 50,000", async () => {
  const read = async (length: number) => {
    const fake = seed();
    const id = jobOf(fake, ADA, [photoOf(1)]);
    fake.replies.push(() => says("가".repeat(length))());
    await runWorker(fake);
    const photo = fake.jobs.get(id)!.photos[0]!;
    assert.equal(photo.status, "read", "setup: the photo was read");
    return [...photo.reading!].length;
  };
  assert.equal(await read(50_000), 50_000);
  assert.equal(await read(50_001), 50_000);
});

Deno.test("a lane waits 5 seconds while every queued photo is hidden, against an empty queue", async () => {
  const hidden = seed();
  const id = jobOf(hidden, ADA, [photoOf(1)]);
  hidden.queue.forEach((message) => message.visible = false);
  await runWorker(hidden);
  assert.equal(hidden.jobs.get(id)!.photos[0]!.status, "queued");
  assert.ok(hidden.waited.length > 0, "the lanes waited");
  assert.deepEqual(new Set(hidden.waited), new Set([5_000]));

  const empty = seed();
  await runWorker(empty);
  assert.deepEqual(empty.waited, []);
});
