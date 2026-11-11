/**
 * `POST /assistant`: a message, answered as server-sent events from the tool loop over the caller's
 * plan's model (ADR 0190, ADR 0195), and recorded when its turn ends.
 */

import { SupabaseError } from "../_shared/auth.ts";
import {
  type Answer,
  type Caller,
  MAX_BODY_BYTES,
  readBody,
  refusal,
  refuseSuspended,
  storeOf,
} from "./answer.ts";
import { converse, MAX_MODEL_CALLS } from "./converse.ts";
import { MAX_TURNS, readMessage, shortenReplies } from "./history.ts";
import { MAX_OUTPUT_TOKENS } from "./providers.ts";
import {
  beginMessage,
  charged,
  finishMessage,
  type Outcome,
  type Usage,
} from "./supabase.ts";
import { kick } from "./worker.ts";

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

/** Answers a message with a stream, which logs its own line when it ends. */
export async function messageRequest(caller: Caller): Promise<Answer> {
  const { deps, service, entry, userId, started, log } = caller;
  const read = await readBody(caller.request, MAX_REQUEST_BYTES, entry);
  if ("answer" in read) return read.answer;
  // The server's own replies, resent, are shortened before what the request holds is measured.
  const body = shortenReplies(read.body);
  const kept = new TextEncoder().encode(JSON.stringify(body)).length;
  if (kept > MAX_BODY_BYTES) return refusal(413, "too_large", entry);
  const suspended = await refuseSuspended(caller);
  if (suspended !== null) return suspended;
  const store = storeOf(caller);
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
