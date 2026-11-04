/**
 * The assistant's two requests (ADR 0187): a message, answered as server-sent events from a tool
 * loop over the caller's plan's model, and a commit of the cards the user checked in a proposal.
 */

import { authenticate, SupabaseError, type UserId } from "../_shared/auth.ts";
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
  sseEvents,
  type ToolResult,
  type Turn,
} from "./providers.ts";
import {
  beginMessage,
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

/** The most model calls one message makes, tool calls and pauses included. */
export const MAX_MODEL_CALLS = 8;
/** How long one message may take, under the platform's 150 s wall clock on every plan. */
export const TURN_LIMIT_MS = 120_000;
/** The most turns a request carries; the client keeps the rest of the chat. */
export const MAX_TURNS = 40;
/** The longest one turn's text may be. */
export const MAX_TURN_TEXT = 4000;
/** The largest body a request may send, proposals included. */
export const MAX_BODY_BYTES = 512 * 1024;

/** How a request ended: a refusal's code, or the turn's outcome. */
export type LogOutcome =
  | Outcome
  | "committed"
  | "bad_request"
  | "unauthenticated"
  | "suspended"
  | "method_not_allowed"
  | "not_found"
  | "too_large"
  | "rate_limited"
  | "refused"
  | "not_configured"
  | "unavailable"
  | "internal";

/** The one line logged per request: never the token, a key, a message or a card. */
export type LogEntry = {
  readonly route: "message" | "commit" | null;
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
  const route = path.endsWith("/assistant/commit")
    ? "commit"
    : path.endsWith("/assistant")
    ? "message"
    : null;
  if (route === null) return refusal(404, "not_found", blank);
  if (request.method !== "POST") {
    return {
      response: new Response(null, { status: 405, headers: { Allow: "POST" } }),
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
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_BODY_BYTES) return refusal(413, "too_large", entry);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return refusal(413, "too_large", entry);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return refusal(400, "bad_request", entry);
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
  let start;
  try {
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
        daily_limit: start.dailyLimit,
        used: start.used,
      });
  }
  const configuration = start.configuration;
  const counted = {
    ...entry,
    plan: start.plan,
    provider: configuration.provider,
    model: configuration.model,
  };
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const send = (event: string, data: unknown) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      let ended: { outcome: Outcome; usage: Usage };
      try {
        ended = await converse(incoming, store, deps, start, send, started);
      } catch (error) {
        log({ ...counted, outcome: "internal" });
        controller.error(error);
        throw error;
      }
      send("usage", {
        outcome: ended.outcome,
        model_calls: ended.usage.modelCalls,
        input_tokens: ended.usage.inputTokens,
        output_tokens: ended.usage.outputTokens,
        reasoning_tokens: ended.usage.reasoningTokens,
        web_search_requests: ended.usage.webSearchRequests,
        daily_limit: start.dailyLimit,
        used: start.used,
      });
      controller.close();
      // The record is telemetry: when it fails, the answer stands and the log says so.
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

/** A message request read: the turns for the model, the proposals they hold, and the note open. */
type Incoming = {
  readonly turns: readonly Turn[];
  readonly proposals: readonly Proposal[];
  readonly deckId: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An earlier proposal as the model reads it: its ids, and each group's first fronts. */
function describe(proposal: Proposal, ids: IdSource): string {
  const groups = proposal.groups.map((group) => {
    const fronts = group.cards.slice(0, 5).map(({ card }) => {
      const read = readCard(card, ids);
      return typeof read === "string" ? "?" : read.front;
    });
    return `group ${group.id} "${group.title}" (${group.format}, ${group.cards.length} cards: ${
      fronts.join(" / ")
    })`;
  });
  return `[proposal ${proposal.id} of ${
    proposal.kind === "cards" ? "new cards" : "changes"
  } for the note "${proposal.deck.name}": ${groups.join("; ")}]`;
}

/** The turns, their proposals and the open note, or null when the body is not such a request. */
function readMessage(body: unknown, ids: IdSource): Incoming | null {
  if (!isRecord(body) || !Array.isArray(body.messages)) return null;
  const messages = body.messages;
  if (messages.length === 0 || messages.length > MAX_TURNS) return null;
  const turns: Turn[] = [];
  const proposals: Proposal[] = [];
  for (const message of messages) {
    if (
      !isRecord(message) ||
      (message.role !== "user" && message.role !== "assistant")
    ) {
      return null;
    }
    const text = typeof message.text === "string" ? message.text : null;
    if (text === null || [...text].length > MAX_TURN_TEXT) return null;
    const parts = [text];
    if (message.role === "assistant") {
      for (
        const value of Array.isArray(message.proposals) ? message.proposals : []
      ) {
        const proposal = parseProposal(value);
        if (proposal === null) return null;
        proposals.push(proposal);
        parts.push(describe(proposal, ids));
      }
      if (message.choice !== undefined) {
        const choice = message.choice;
        if (
          !isRecord(choice) || typeof choice.prompt !== "string" ||
          !Array.isArray(choice.options) || !choice.options.every((o) =>
            typeof o === "string"
          )
        ) return null;
        parts.push(`[asked: ${choice.prompt} (${choice.options.join(" / ")})]`);
      }
    } else if (
      message.proposals !== undefined || message.choice !== undefined
    ) {
      return null;
    }
    const joined = parts.filter((part) => part.trim() !== "").join("\n\n");
    if (joined === "") return null;
    turns.push({ role: message.role, text: joined });
  }
  if (turns.at(-1)?.role !== "user") return null;
  const context = body.context;
  let deckId: string | null = null;
  if (context !== undefined) {
    const id = isRecord(context) && typeof context.deck_id === "string"
      ? context.deck_id.toLowerCase()
      : null;
    if (id === null || !UUID.test(id)) return null;
    deckId = id;
  }
  return { turns, proposals, deckId };
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
 * choice, or the loop reaches its call or time limit.
 */
async function converse(
  incoming: Incoming,
  store: Store,
  deps: HandlerDeps,
  start: Extract<Start, { kind: "allowed" }>,
  send: (event: string, data: unknown) => void,
  started: number,
): Promise<{ outcome: Outcome; usage: Usage }> {
  const configuration = start.configuration;
  const adapter = ADAPTERS[configuration.provider];
  let usage = ZERO;
  const failed = () => {
    send("error", { error: "model_error" });
    return { outcome: "model_error" as const, usage };
  };
  let apiKey;
  try {
    apiKey = await deps.keys.get(configuration.provider);
  } catch (error) {
    if (!(error instanceof SupabaseError)) throw error;
    apiKey = null;
  }
  if (apiKey === null) return failed();
  let system = configuration.prompt;
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
  for (;;) {
    if (usage.modelCalls >= MAX_MODEL_CALLS) {
      return { outcome: "depth_limit", usage };
    }
    const left = TURN_LIMIT_MS - (deps.now() - started);
    if (left <= 0) return { outcome: "time_limit", usage };
    let result;
    try {
      const response = await deps.fetch(adapter.url, {
        method: "POST",
        signal: deps.timeout(left),
        headers: adapter.headers(apiKey),
        body: JSON.stringify(adapter.body({
          configuration,
          system,
          messages,
          tools: ASSISTANT_TOOLS,
        })),
      });
      if (!response.ok || response.body === null) {
        await response.body?.cancel();
        usage = plus(usage, {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          webSearchRequests: 0,
        });
        return failed();
      }
      result = await adapter.read(sseEvents(response.body), (event) => {
        if (event.kind === "text") send("text", { delta: event.delta });
        else if (!cited.has(event.url)) {
          cited.add(event.url);
          send("citation", { url: event.url, title: event.title });
        }
      });
    } catch {
      // A failed request, an aborted one, or a stream that broke off or reported an error.
      usage = plus(usage, {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        webSearchRequests: 0,
      });
      return failed();
    }
    usage = plus(usage, result.usage);
    messages.push(result.message);
    if (result.stop === "pause") continue;
    if (result.stop !== "tool_use" || result.toolCalls.length === 0) {
      return { outcome: "ok", usage };
    }
    const results: ToolResult[] = [];
    let asked: Choice | null = null;
    for (const call of result.toolCalls) {
      let ran;
      try {
        ran = call.input === null
          ? {
            content: "The arguments were not JSON.",
            isError: true,
            shown: null,
          }
          : await runTool(call.name, call.input, store, deps, proposals);
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
