/**
 * The tool loop of one message (ADR 0190): each model call streams its text and citations, the
 * tools it calls run, and their proposals and choices are sent.
 */

import { SupabaseError } from "../_shared/auth.ts";
import { cardFormIndex, type Skills } from "../_shared/card_forms.ts";
import { readDeck, type Store } from "../_shared/store.ts";
import type { HandlerDeps } from "./answer.ts";
import type { Incoming } from "./history.ts";
import type { PhotoContext } from "./photo_tools.ts";
import {
  ADAPTERS,
  type CallUsage,
  fetchFailed,
  NO_USAGE,
  sseEvents,
  StreamError,
  type ToolResult,
  withInputAtLeast,
} from "./providers.ts";
import type { Outcome, Start, Usage } from "./supabase.ts";
import { ASSISTANT_TOOLS, type Choice, runTool } from "./tools.ts";

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
export async function converse(
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
