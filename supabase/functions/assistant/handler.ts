/**
 * The assistant's requests (ADR 0190, ADR 0195, ADR 0198): a message, answered as server-sent
 * events from a tool loop over the caller's plan's model, a commit of the cards the user checked in
 * a proposal, an admin's draft configuration (`settings.ts`), a photo job's poll and cancel, and the
 * photo jobs' worker (`worker.ts`).
 */

import { authenticate, SupabaseError, type UserId } from "../_shared/auth.ts";
import {
  cardFormIndex,
  type CardForms,
  type Skills,
} from "../_shared/card_forms.ts";
import type { Keys } from "../_shared/keys.ts";
import type { IdSource } from "../_shared/cards.ts";
import { readCard } from "../_shared/input.ts";
import { readDeck, type Store } from "../_shared/store.ts";
import type { ToolDeps } from "../_shared/tools.ts";
import { commit } from "./commit.ts";
import type { Config } from "./config.ts";
import {
  ADAPTERS,
  type CallUsage,
  fetchFailed,
  MAX_OUTPUT_TOKENS,
  NO_USAGE,
  sseEvents,
  StreamError,
  type ToolResult,
  type Turn,
  withInputAtLeast,
} from "./providers.ts";
import {
  cancelJob,
  clearJob,
  type Job,
  MAX_JOB_PHOTOS,
  readJob,
} from "./jobs.ts";
import type { PhotoContext } from "./photo_tools.ts";
import { saveDraft, type SettingsOutcome, settingsStatus } from "./settings.ts";
import {
  beginMessage,
  charged,
  finishMessage,
  type Outcome,
  type Start,
  type Usage,
  userSuspended,
} from "./supabase.ts";
import {
  ASSISTANT_TOOLS,
  type Choice,
  parseProposal,
  type Proposal,
  runTool,
} from "./tools.ts";
import { kick, work } from "./worker.ts";

/** The most model calls one message makes, tool calls and pauses included. */
export const MAX_MODEL_CALLS = 8;
/** Sent as text before the text of a call that follows an interim one, for a client that keeps appending. */
export const PARAGRAPH_BREAK = "\n\n";
/** What the model is told about speaking, after the card forms index; code-owned, so no prompt version. */
export const REPLY_RULES = `# Replies

You send one reply a turn. What you write before a tool call is a passing status line the user sees for a moment and then loses, so keep it to a short remark.
Give the reply in the last step of the turn, in Markdown, which the chat renders.
Never name a tool, a field or an error's text to the user. When something failed, say what happened in the user's terms and what you will do or what they can do.
`;
/** How long one message may take, under the platform's 150 s wall clock on every plan. */
export const TURN_LIMIT_MS = 120_000;
/** The most turns a request carries; the client keeps the rest of the chat. */
export const MAX_TURNS = 40;
/** The longest a user turn's text may be, and the length an assistant turn's is shortened to. */
export const MAX_TURN_TEXT = 4000;
/** The longest one turn may be once the proposals and the choice it showed are described in it. */
export const MAX_DESCRIBED_TURN = 16_000;
/** The most characters of a card's front an earlier proposal's description shows. */
const FRONT_SHOWN = 80;
/** The largest body a request may hold, proposals included, once its replies are shortened. */
export const MAX_BODY_BYTES = 512 * 1024;
/**
 * The longest reply the server streams in characters, at four characters a token over every call's
 * output cap, the bound a resent reply is sent at.
 */
export const MAX_REPLY_TEXT = MAX_MODEL_CALLS * MAX_OUTPUT_TOKENS * 4;
/**
 * The largest message body read: every turn a longest reply of three-byte characters, beside what
 * `MAX_BODY_BYTES` holds, so the server's own history is never refused for its size.
 */
export const MAX_REQUEST_BYTES = MAX_BODY_BYTES +
  MAX_TURNS * MAX_REPLY_TEXT * 3;

/**
 * How long a running job may go without a read begun before its poll asks for the worker again:
 * past the 150 s a photo's message is hidden while it is read.
 */
export const STALE_MS = 180_000;

/** How a request ended: a refusal's code, the turn's outcome, or a photo read's. */
export type LogOutcome =
  | Outcome
  | "unreadable"
  | "not_sent"
  | "polled"
  | "working"
  | "committed"
  | "bad_request"
  | "unauthenticated"
  | "suspended"
  | "method_not_allowed"
  | "not_found"
  | "too_large"
  | "rate_limited"
  | "busy"
  | "refused"
  | "not_configured"
  | "unavailable"
  | "internal"
  | SettingsOutcome["kind"];

/** The one line logged per request: never the token, a key, a message or a card. */
export type LogEntry = {
  readonly route:
    | "message"
    | "commit"
    | "settings"
    | "job"
    | "cancel"
    | "work"
    | null;
  readonly user_id: UserId | null;
  readonly plan: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly model_calls: number | null;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly reasoning_tokens: number | null;
  readonly web_search_requests: number | null;
  readonly latency_ms: number;
  readonly outcome_recorded: boolean | null;
  readonly outcome: LogOutcome;
};

export type HandlerDeps = ToolDeps & {
  readonly config: Config;
  readonly fetch: typeof fetch;
  readonly log: (entry: LogEntry) => void;
  readonly keys: Keys;
  readonly skills: CardForms;
  /** Keeps the invocation alive for [task] after its response, as `EdgeRuntime.waitUntil` does. */
  readonly background: (task: Promise<void>) => void;
  /** A promise that settles after [ms]. */
  readonly wait: (ms: number) => Promise<void>;
};

type Entry = Omit<LogEntry, "latency_ms">;

const blank: Entry = {
  route: null,
  user_id: null,
  plan: null,
  provider: null,
  model: null,
  model_calls: null,
  input_tokens: null,
  output_tokens: null,
  reasoning_tokens: null,
  web_search_requests: null,
  outcome_recorded: null,
  outcome: "internal",
};

function refusal(
  status: number,
  error: LogOutcome,
  entry: Entry,
  extra: Record<string, unknown> = {},
): { response: Response; entry: Entry } {
  return {
    response: Response.json({ error, ...extra }, { status }),
    entry: { ...entry, outcome: error },
  };
}

export function createHandler(
  deps: HandlerDeps,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const started = deps.now();
    const log = (entry: Entry) =>
      deps.log({ ...entry, latency_ms: Math.round(deps.now() - started) });
    let answered;
    try {
      answered = await handle(request, deps, started, log);
    } catch (error) {
      log(blank);
      throw error;
    }
    if (answered.entry !== null) log(answered.entry);
    return answered.response;
  };
}

/** Answers [request]; a stream logs its own line when it ends, so its entry here is null. */
async function handle(
  request: Request,
  deps: HandlerDeps,
  started: number,
  log: (entry: Entry) => void,
): Promise<{ response: Response; entry: Entry | null }> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  const job = path.match(/\/assistant\/jobs\/([0-9a-fA-F-]{36})(\/cancel)?$/);
  const jobId = job?.[1]?.toLowerCase() ?? null;
  const route = path.endsWith("/assistant/commit")
    ? "commit"
    : path.endsWith("/assistant/settings/configuration")
    ? "settings"
    : path.endsWith("/assistant/jobs/work")
    ? "work"
    : jobId !== null && UUID.test(jobId)
    ? job?.[2] === undefined ? "job" : "cancel"
    : path.endsWith("/assistant")
    ? "message"
    : null;
  if (route === null) return refusal(404, "not_found", blank);
  const method = route === "job" ? "GET" : "POST";
  if (request.method !== method) {
    return {
      response: new Response(null, { status: 405, headers: { Allow: method } }),
      entry: { ...blank, route, outcome: "method_not_allowed" },
    };
  }
  const config = deps.config;
  if (config.kind === "not_configured") {
    return refusal(503, "not_configured", { ...blank, route });
  }
  const service = {
    url: config.supabaseUrl,
    serviceRoleKey: config.serviceRoleKey,
    fetch: deps.fetch,
  };
  if (route === "work") {
    const bearer = request.headers.get("Authorization")?.match(
      /^Bearer (\S+)$/,
    )?.[1];
    if (bearer === undefined || !sameText(bearer, config.serviceRoleKey)) {
      return refusal(401, "unauthenticated", { ...blank, route });
    }
    deps.background(
      work({
        supabase: service,
        fetch: deps.fetch,
        keys: deps.keys,
        now: deps.now,
        timeout: deps.timeout,
        wait: deps.wait,
        log: deps.log,
      }, started).catch((error) => {
        log({ ...blank, route });
        throw error;
      }),
    );
    return {
      response: Response.json({ working: true }, { status: 202 }),
      entry: { ...blank, route, outcome: "working" },
    };
  }
  if (route === "settings") {
    let outcome;
    try {
      outcome = await saveDraft(request, {
        supabase: service,
        keys: deps.keys,
        fetch: deps.fetch,
        timeout: deps.timeout,
      });
    } catch (error) {
      if (error instanceof SupabaseError) {
        return refusal(503, "unavailable", { ...blank, route });
      }
      throw error;
    }
    return {
      response: Response.json(
        outcome.kind === "saved"
          ? { saved: true, configuration_id: outcome.configurationId }
          : { error: outcome.kind },
        { status: settingsStatus(outcome) },
      ),
      entry: { ...blank, route, outcome: outcome.kind },
    };
  }
  const authorization = request.headers.get("Authorization");
  const token = authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (token === undefined) {
    return refusal(401, "unauthenticated", { ...blank, route });
  }
  let userId: UserId | null;
  try {
    userId = await authenticate(authorization, service);
  } catch (error) {
    if (error instanceof SupabaseError) {
      return refusal(503, "unavailable", { ...blank, route });
    }
    throw error;
  }
  if (userId === null) {
    return refusal(401, "unauthenticated", { ...blank, route });
  }
  const entry: Entry = { ...blank, route, user_id: userId };
  if (route === "job" || route === "cancel") {
    // The route was read from a job id, so it is set.
    return await jobRequest(route, jobId ?? "", userId, service, entry, deps);
  }
  const cap = route === "message" ? MAX_REQUEST_BYTES : MAX_BODY_BYTES;
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > cap) return refusal(413, "too_large", entry);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > cap) {
    return refusal(413, "too_large", entry);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return refusal(400, "bad_request", entry);
  }
  if (route === "message") {
    // The server's own replies, resent, are shortened before what the request holds is measured.
    body = shortenReplies(body);
    const kept = new TextEncoder().encode(JSON.stringify(body)).length;
    if (kept > MAX_BODY_BYTES) return refusal(413, "too_large", entry);
  }
  try {
    if (await userSuspended(userId, service)) {
      return refusal(403, "suspended", entry);
    }
  } catch (error) {
    if (error instanceof SupabaseError) {
      return refusal(503, "unavailable", entry);
    }
    throw error;
  }
  const store: Store = {
    url: config.supabaseUrl,
    anonKey: config.anonKey,
    // The token authenticate accepted, so the tools act as the caller under row-level security.
    token,
    userId,
    fetch: deps.fetch,
  };
  if (route === "commit") return await commitRequest(body, store, deps, entry);
  const incoming = readMessage(body, deps);
  if (incoming === null) return refusal(400, "bad_request", entry);
  let skills;
  let start;
  try {
    skills = await deps.skills.read(store);
    start = await beginMessage(userId, service);
  } catch (error) {
    if (error instanceof SupabaseError) {
      return refusal(503, "unavailable", entry);
    }
    throw error;
  }
  switch (start.kind) {
    case "not_configured":
      return refusal(503, "not_configured", entry);
    case "unavailable":
      return refusal(503, "unavailable", { ...entry, plan: start.plan });
    case "rate_limited":
      return refusal(429, "rate_limited", { ...entry, plan: start.plan }, {
        token_budget: start.tokenBudget,
        tokens_used: start.tokensUsed,
      });
    case "busy":
      return refusal(429, "busy", { ...entry, plan: start.plan });
  }
  const configuration = start.configuration;
  const counted = {
    ...entry,
    plan: start.plan,
    provider: configuration.provider,
    model: configuration.model,
  };
  const encoder = new TextEncoder();
  // Aborted when the client goes away and cancels the stream: nothing more is sent to it.
  const client = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const send = (event: string, data: unknown) => {
        if (client.signal.aborted) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      let ended: { outcome: Outcome; usage: Usage };
      try {
        ended = await converse(
          incoming,
          store,
          deps,
          skills,
          start,
          {
            userId,
            attached: incoming.attached,
            supabase: service,
            ids: deps,
            kick: () => kick(service),
          },
          send,
          started,
          client.signal,
        );
      } catch (error) {
        log({ ...counted, outcome: "internal" });
        if (!client.signal.aborted) controller.error(error);
        throw error;
      }
      // The record charges the message, before the client sees the end and may send the next.
      // When it fails, the answer stands and the log says so.
      let recorded = true;
      try {
        await finishMessage(
          start.messageId,
          ended.outcome,
          ended.usage,
          deps.now() - started,
          service,
        );
      } catch (error) {
        if (!(error instanceof SupabaseError)) throw error;
        recorded = false;
      }
      send("usage", {
        outcome: ended.outcome,
        model_calls: ended.usage.modelCalls,
        input_tokens: ended.usage.inputTokens,
        output_tokens: ended.usage.outputTokens,
        reasoning_tokens: ended.usage.reasoningTokens,
        web_search_requests: ended.usage.webSearchRequests,
        token_budget: start.tokenBudget,
        tokens_used: start.tokensUsed + charged(ended.usage),
      });
      if (!client.signal.aborted) controller.close();
      log({
        ...counted,
        model_calls: ended.usage.modelCalls,
        input_tokens: ended.usage.inputTokens,
        output_tokens: ended.usage.outputTokens,
        reasoning_tokens: ended.usage.reasoningTokens,
        web_search_requests: ended.usage.webSearchRequests,
        outcome_recorded: recorded,
        outcome: ended.outcome,
      });
    },
    cancel: () => client.abort(),
  });
  return {
    response: new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    }),
    entry: null,
  };
}

/**
 * A message request read: the turns for the model, the proposals they hold, the note open, the
 * user's time zone, and the photos of the latest user turn that attached any.
 */
type Incoming = {
  readonly turns: readonly Turn[];
  readonly proposals: readonly Proposal[];
  readonly deckId: string | null;
  readonly timeZone: string | null;
  readonly attached: readonly string[];
};

/** The shape of an IANA name, Area/Location or UTC, which leaves out an offset such as +05:00. */
const TIME_ZONE = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2})$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * An earlier proposal as the model reads it: its ids and sizes, and each group's first [fronts]
 * fronts, or with [fronts] null, its groups counted and not named.
 */
function describe(
  proposal: Proposal,
  ids: IdSource,
  fronts: number | null,
): string {
  const header = `[proposal ${proposal.id} of ${
    proposal.kind === "cards" ? "new cards" : "changes"
  } for the note "${proposal.deck.name}"`;
  if (fronts === null) {
    const cards = proposal.groups.reduce((n, g) => n + g.cards.length, 0);
    return `${header}: ${proposal.groups.length} groups of ${cards} cards]`;
  }
  const groups = proposal.groups.map((group) => {
    const shown = group.cards.slice(0, fronts).map(({ card }) => {
      const read = readCard(card, ids);
      return typeof read === "string"
        ? "?"
        : [...read.front].slice(0, FRONT_SHOWN).join("");
    });
    return `group ${group.id} "${group.title}" (${group.format}, ${group.cards.length} cards${
      shown.length === 0 ? "" : `: ${shown.join(" / ")}`
    })`;
  });
  return `${header}: ${groups.join("; ")}]`;
}

/** How many fronts of each group a turn's proposals show, most first. */
const FRONTS_SHOWN = [5, 1, 0] as const;

/**
 * A turn as the model reads it: [text], its proposals and [notes], such as the question it asked,
 * each proposal described in as much detail as fits `MAX_DESCRIBED_TURN` and those that still do
 * not fit counted. Null when nothing is said, or when the text and the notes alone are over the cap.
 */
function describeTurn(
  text: string,
  proposals: readonly Proposal[],
  notes: readonly string[],
  ids: IdSource,
): string | null {
  const join = (described: readonly string[]) =>
    [text, ...described, ...notes]
      .filter((part) => part.trim() !== "").join("\n\n");
  const fits = (joined: string) => [...joined].length <= MAX_DESCRIBED_TURN;
  for (const fronts of FRONTS_SHOWN) {
    const joined = join(
      proposals.map((proposal) => describe(proposal, ids, fronts)),
    );
    if (fits(joined)) return joined === "" ? null : joined;
  }
  const counted = proposals.map((proposal) => describe(proposal, ids, null));
  for (let shown = counted.length; shown >= 0; shown--) {
    const rest = counted.length - shown;
    const joined = join([
      ...counted.slice(0, shown),
      ...(rest === 0 ? [] : [`[and ${rest} more proposals]`]),
    ]);
    if (fits(joined)) return joined;
  }
  return null;
}

/**
 * [text] within `MAX_TURN_TEXT` characters: whole when it fits, and otherwise its head and tail
 * around a marker counting the characters left out.
 */
function shorten(text: string): string {
  const chars = [...text];
  if (chars.length <= MAX_TURN_TEXT) return text;
  const marker = (left: number) => `\n\n[… ${left} characters left out …]\n\n`;
  // The marker for the whole text is the longest any omission needs.
  const kept = MAX_TURN_TEXT - [...marker(chars.length)].length;
  const head = Math.ceil(kept / 2);
  const tail = kept - head;
  return chars.slice(0, head).join("") + marker(chars.length - kept) +
    chars.slice(chars.length - tail).join("");
}

/** [body] with each assistant turn's text shortened, its other parts as they were. */
function shortenReplies(body: unknown): unknown {
  if (!isRecord(body) || !Array.isArray(body.messages)) return body;
  return {
    ...body,
    messages: body.messages.map((message: unknown) =>
      isRecord(message) && message.role === "assistant" &&
        typeof message.text === "string"
        ? { ...message, text: shorten(message.text) }
        : message
    ),
  };
}

/** The turns, their proposals and the open note, or null when the body is not such a request. */
function readMessage(body: unknown, ids: IdSource): Incoming | null {
  if (!isRecord(body) || !Array.isArray(body.messages)) return null;
  const messages = body.messages;
  if (messages.length === 0 || messages.length > MAX_TURNS) return null;
  const turns: Turn[] = [];
  const proposals: Proposal[] = [];
  let attached: readonly string[] = [];
  for (const message of messages) {
    if (
      !isRecord(message) ||
      (message.role !== "user" && message.role !== "assistant")
    ) {
      return null;
    }
    const text = typeof message.text === "string" ? message.text : null;
    // An assistant turn's text is already shortened (`shortenReplies`); a user's longer is refused.
    if (text === null || [...text].length > MAX_TURN_TEXT) return null;
    const shown: Proposal[] = [];
    const notes: string[] = [];
    if (message.role === "assistant") {
      for (
        const value of Array.isArray(message.proposals) ? message.proposals : []
      ) {
        const proposal = parseProposal(value);
        if (proposal === null) return null;
        shown.push(proposal);
      }
      if (message.choice !== undefined) {
        const choice = message.choice;
        if (
          !isRecord(choice) || typeof choice.prompt !== "string" ||
          !Array.isArray(choice.options) || !choice.options.every((o) =>
            typeof o === "string"
          )
        ) return null;
        notes.push(
          `[asked: ${choice.prompt} (${choice.options.join(" / ")})]`,
        );
      }
      if (message.job !== undefined) {
        const job = readJobShown(message.job);
        if (job === null) return null;
        notes.push(`[photo job ${job.id} started over ${job.photos} photos]`);
      }
      if (message.photos !== undefined) return null;
    } else if (
      message.proposals !== undefined || message.choice !== undefined ||
      message.job !== undefined
    ) {
      return null;
    } else if (message.photos !== undefined) {
      const photos = readPhotos(message.photos);
      if (photos === null) return null;
      attached = photos;
      notes.push(`[${photos.length} photos attached]`);
    }
    const described = describeTurn(text, shown, notes, ids);
    if (described === null) {
      // An assistant turn that said nothing, as one does when its user left or its model failed
      // before any text, is no turn: clients send it back. A user turn that said nothing, and a
      // turn over the cap, are refused.
      const empty = text.trim() === "" && shown.length === 0 &&
        notes.length === 0;
      if (message.role === "user" || !empty) return null;
      continue;
    }
    proposals.push(...shown);
    const last = turns.at(-1);
    if (message.role === "assistant" && last === undefined) {
      // Anthropic requires a history that does not start with an assistant turn, as a window of the last 40 can.
      continue;
    }
    if (message.role === "user" && last?.role === "user") {
      // The turns dropped between two user turns leave them adjacent; the providers take alternation.
      turns[turns.length - 1] = {
        ...last,
        text: `${last.text}\n\n${described}`,
      };
      continue;
    }
    turns.push({ role: message.role, text: described });
  }
  if (turns.at(-1)?.role !== "user") return null;
  const context = body.context;
  let deckId: string | null = null;
  let timeZone: string | null = null;
  if (context !== undefined) {
    if (!isRecord(context)) return null;
    if (context.deck_id !== undefined) {
      const id = typeof context.deck_id === "string"
        ? context.deck_id.toLowerCase()
        : null;
      if (id === null || !UUID.test(id)) return null;
      deckId = id;
    }
    if (context.time_zone !== undefined) {
      const zone = readTimeZone(context.time_zone);
      if (zone === "refused") return null;
      timeZone = zone;
    }
  }
  return { turns, proposals, deckId, timeZone, attached };
}

/**
 * An IANA zone name as the runtime spells it; null when `Intl` does not know the name, which is
 * read as no zone; `"refused"` for what is no IANA name at all: not a string, or an offset or an
 * abbreviation.
 */
function readTimeZone(value: unknown): string | null | "refused" {
  if (typeof value !== "string" || !TIME_ZONE.test(value)) return "refused";
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: value })
      .resolvedOptions().timeZone;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/** A user turn's photo ids: 1 to `MAX_JOB_PHOTOS` distinct uuids, or null. */
function readPhotos(value: unknown): readonly string[] | null {
  if (
    !Array.isArray(value) || value.length === 0 ||
    value.length > MAX_JOB_PHOTOS
  ) return null;
  const ids: string[] = [];
  for (const id of value) {
    const read = typeof id === "string" ? id.toLowerCase() : "";
    if (!UUID.test(read) || ids.includes(read)) return null;
    ids.push(read);
  }
  return ids;
}

/** An assistant turn's job, as the `job` event sent it, or null when it is not one. */
function readJobShown(value: unknown): { id: string; photos: number } | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const id = value.id.toLowerCase();
  const photos = value.photos;
  if (
    !UUID.test(id) || typeof photos !== "number" ||
    !Number.isSafeInteger(photos) || photos < 1 || photos > MAX_JOB_PHOTOS
  ) return null;
  return { id, photos };
}

/** Whether [a] and [b] are the same text, compared in a time that does not depend on where they differ. */
function sameText(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let differ = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    differ |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return differ === 0;
}

/** A job as its poll answers it: each photo's status, never its reading. */
function jobBody(id: string, job: Job): Record<string, unknown> {
  const count = (status: string) =>
    job.photos.filter((photo) => photo.status === status).length;
  return {
    id,
    status: job.status,
    photos: job.photos.map((photo) => ({
      position: photo.position,
      photo_id: photo.photoId,
      status: photo.status,
    })),
    read: count("read"),
    queued: count("queued"),
    failed: count("failed"),
    skipped: count("skipped"),
    cancelled: count("cancelled"),
    created_at: job.createdAt,
    finished_at: job.finishedAt,
  };
}

/**
 * A photo job's poll, which asks for the worker again when a running job has begun no read for
 * `STALE_MS`, or its cancel, which deletes its photos.
 */
async function jobRequest(
  route: "job" | "cancel",
  jobId: string,
  userId: UserId,
  service: { url: string; serviceRoleKey: string; fetch: typeof fetch },
  entry: Entry,
  deps: HandlerDeps,
): Promise<{ response: Response; entry: Entry }> {
  try {
    if (route === "cancel") {
      const status = await cancelJob(userId, jobId, service);
      if (status === null) return refusal(404, "not_found", entry);
      if (status === "cancelled") await clearJob(userId, jobId, service);
      return {
        response: Response.json({ id: jobId, status }),
        entry: { ...entry, outcome: "cancelled" },
      };
    }
    const job = await readJob(userId, jobId, service);
    if (job === null) return refusal(404, "not_found", entry);
    const last = Date.parse(job.lastStepAt ?? job.createdAt);
    if (job.status === "running" && deps.now() - last > STALE_MS) {
      await kick(service);
    }
    return {
      response: Response.json(jobBody(jobId, job)),
      entry: { ...entry, outcome: "polled" },
    };
  } catch (error) {
    if (error instanceof SupabaseError) {
      return refusal(503, "unavailable", entry);
    }
    throw error;
  }
}

const ZERO: Usage = {
  modelCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  webSearchRequests: 0,
};

function plus(usage: Usage, call: CallUsage): Usage {
  return {
    modelCalls: usage.modelCalls + 1,
    inputTokens: usage.inputTokens + call.inputTokens,
    outputTokens: usage.outputTokens + call.outputTokens,
    reasoningTokens: usage.reasoningTokens + call.reasoningTokens,
    webSearchRequests: usage.webSearchRequests + call.webSearchRequests,
  };
}

const UNREACHABLE =
  "knowno's server did not answer. Nothing was read or shown by this call; try again in a moment.";

/**
 * Runs the tool loop for one message: each model call streams its text and citations, the tools it
 * calls run, and their proposals and choices are sent, until the model ends its turn, asks a
 * choice, the loop reaches its call or time limit, or the client goes away and [client] aborts.
 */
async function converse(
  incoming: Incoming,
  store: Store,
  deps: HandlerDeps,
  skills: Skills,
  start: Extract<Start, { kind: "allowed" }>,
  photos: PhotoContext,
  send: (event: string, data: unknown) => void,
  started: number,
  client: AbortSignal,
): Promise<{ outcome: Outcome; usage: Usage }> {
  const configuration = start.configuration;
  const adapter = ADAPTERS[configuration.provider];
  let usage = ZERO;
  // Fetches share the turn's searches but are not recorded: Anthropic charges none (ADR 0190).
  let fetches = 0;
  const failed = () => {
    send("error", { error: "model_error" });
    return { outcome: "model_error" as const, usage };
  };
  // A call that broke off: the client went away, the turn's time ran out, or the call failed. It
  // is charged what the provider had reported of it.
  const interrupted = (reported: CallUsage, request: string) => {
    usage = plus(usage, withInputAtLeast(reported, request));
    if (client.aborted) return { outcome: "cancelled" as const, usage };
    if (deps.now() - started >= TURN_LIMIT_MS) {
      return { outcome: "time_limit" as const, usage };
    }
    return failed();
  };
  let apiKey;
  try {
    apiKey = await deps.keys.get(configuration.provider);
  } catch (error) {
    if (!(error instanceof SupabaseError)) throw error;
    apiKey = null;
  }
  if (apiKey === null) return failed();
  let system = `${configuration.prompt}\n\n${
    cardFormIndex(
      skills,
      () => "",
      "Every card of a proposal group takes the group's form.",
    )
  }\n${REPLY_RULES}`;
  if (incoming.deckId !== null) {
    const deck = await readDeck(store, incoming.deckId).catch((error) => {
      if (error instanceof SupabaseError) return null;
      throw error;
    });
    if (deck !== null) {
      system +=
        `\n\nThe user opened this chat inside their note "${deck.name}" (deck_id ${deck.id}).`;
    }
  }
  const messages: unknown[] = adapter.history(incoming.turns);
  const proposals = [...incoming.proposals];
  const cited = new Set<string>();
  // Whether a call's text was marked interim and no text has followed it yet: the next text
  // is sent after a paragraph break, for a client that does not read `interim`.
  let separate = false;
  for (;;) {
    if (client.aborted) return { outcome: "cancelled", usage };
    if (usage.modelCalls >= MAX_MODEL_CALLS) {
      return { outcome: "depth_limit", usage };
    }
    const left = TURN_LIMIT_MS - (deps.now() - started);
    if (left <= 0) return { outcome: "time_limit", usage };
    const searchesLeft = configuration.maxSearches - usage.webSearchRequests -
      fetches;
    const request = {
      method: "POST",
      // Not the client's: a call goes on to its end after the client goes, so that the usage the
      // provider reports only there is charged.
      signal: deps.timeout(left),
      headers: adapter.headers(apiKey),
      body: JSON.stringify(adapter.body({
        // The searches a turn may make are shared by its calls: each call is offered those left.
        configuration: {
          ...configuration,
          webSearch: configuration.webSearch && searchesLeft > 0,
          maxSearches: searchesLeft,
        },
        system,
        messages,
        tools: ASSISTANT_TOOLS,
      })),
    };
    let response;
    try {
      response = await deps.fetch(adapter.url, request);
    } catch (error) {
      if (!fetchFailed(error)) throw error;
      return interrupted(NO_USAGE, request.body);
    }
    if (!response.ok || response.body === null) {
      await response.body?.cancel();
      usage = plus(usage, NO_USAGE);
      return failed();
    }
    let result;
    let streamed = false;
    try {
      result = await adapter.read(sseEvents(response.body), (event) => {
        if (event.kind === "text") {
          if (separate && event.delta !== "") {
            send("text", { delta: PARAGRAPH_BREAK });
            separate = false;
          }
          if (event.delta !== "") streamed = true;
          send("text", { delta: event.delta });
        } else if (!cited.has(event.url)) {
          cited.add(event.url);
          send("citation", { url: event.url, title: event.title });
        }
      });
    } catch (error) {
      if (!(error instanceof StreamError)) throw error;
      return interrupted(error.usage, request.body);
    }
    usage = plus(usage, result.usage);
    fetches += result.usage.webFetchRequests;
    messages.push(...result.messages);
    if (client.aborted) return { outcome: "cancelled", usage };
    if (result.stop === "pause") continue;
    if (result.stop === "cut") {
      send("error", { error: "cut" });
      return { outcome: "cut", usage };
    }
    if (result.stop !== "tool_use" || result.toolCalls.length === 0) {
      return { outcome: "ok", usage };
    }
    const results: ToolResult[] = [];
    let asked: Choice | null = null;
    // The text of a call that ends in tool calls the function runs is interim; a call that
    // asks a choice ends the turn, so its text is the reply. A question the tool refuses does
    // not end it, which is known only once the tools have run.
    const marksFirst = !result.toolCalls.some((call) =>
      call.name === "ask_choice"
    );
    const markInterim = () => {
      if (!streamed) return;
      send("interim", {});
      separate = true;
    };
    if (marksFirst) markInterim();
    for (const call of result.toolCalls) {
      let ran;
      try {
        ran = call.input === null
          ? {
            content: "The arguments were not JSON.",
            isError: true,
            shown: null,
          }
          : await runTool(
            call.name,
            call.input,
            store,
            deps,
            proposals,
            skills,
            photos,
            incoming.timeZone,
          );
      } catch (error) {
        if (!(error instanceof SupabaseError)) throw error;
        ran = { content: UNREACHABLE, isError: true, shown: null };
      }
      if (ran.shown?.kind === "proposal") {
        const shown = ran.shown.proposal;
        const at = proposals.findIndex((one) => one.id === shown.id);
        if (at === -1) proposals.push(shown);
        else proposals[at] = shown;
        send("proposal", shown);
      } else if (ran.shown?.kind === "choice") {
        asked = ran.shown.choice;
        send("choice", asked);
      } else if (ran.shown?.kind === "job") {
        send("job", { ...ran.shown.job, status: "running" });
      }
      results.push({
        call,
        content: typeof ran.content === "string"
          ? ran.content
          : JSON.stringify(ran.content),
        isError: ran.isError,
      });
    }
    messages.push(...adapter.toolResults(results));
    if (asked !== null) return { outcome: "choice", usage };
    if (!marksFirst) markInterim();
  }
}

async function commitRequest(
  body: unknown,
  store: Store,
  deps: HandlerDeps,
  entry: Entry,
): Promise<{ response: Response; entry: Entry }> {
  const proposal = isRecord(body) ? parseProposal(body.proposal) : null;
  if (proposal === null || !isRecord(body)) {
    return refusal(400, "bad_request", entry);
  }
  let committed;
  try {
    committed = await commit(proposal, body.checked, store, deps);
  } catch (error) {
    if (error instanceof SupabaseError) {
      return refusal(503, "unavailable", entry);
    }
    throw error;
  }
  switch (committed.kind) {
    case "bad_request":
      return refusal(400, "bad_request", entry, { message: committed.message });
    case "refused":
      return refusal(422, "refused", entry, { message: committed.message });
    case "written":
      return {
        response: Response.json({ deck: committed.deck, ...committed.result }),
        entry: { ...entry, outcome: "committed" },
      };
  }
}
