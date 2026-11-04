/**
 * How one streamed model call with tools is sent to each provider and its stream read (ADR 0190):
 * OpenRouter's responses, OpenAI's chat completions and Anthropic's messages, each with its own
 * native web search, reasoning setting and usage.
 */

import type { Provider } from "../_shared/keys.ts";
import type { Configuration } from "./supabase.ts";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/responses";
export const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/** The most tokens one call may answer with. */
export const MAX_OUTPUT_TOKENS = 8192;
/** The most tokens of a page Anthropic's web fetch puts in the context. */
export const MAX_FETCH_TOKENS = 20_000;

/** A tool the model may call, as the function defines it. */
export type ToolSpec = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
};

/** A turn of the conversation the client sent, its text already composed. */
export type Turn = {
  readonly role: "user" | "assistant";
  readonly text: string;
};

/** A call of one of the function's tools; `input` is null when its arguments were not JSON. */
export type ToolCall = {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
};

/** A tool's answer to one call, as the model reads it. */
export type ToolResult = {
  readonly call: ToolCall;
  readonly content: string;
  readonly isError: boolean;
};

/** What a call streams as it arrives. */
export type CallEvent =
  | { readonly kind: "text"; readonly delta: string }
  | {
    readonly kind: "citation";
    readonly url: string;
    readonly title: string | null;
  };

/** How a call stopped: its turn ended, it asked for tools, the provider paused it, or the cap cut it. */
export type Stop = "end" | "tool_use" | "pause" | "cut";

/** What one call used, as its provider reports it; web fetches are Anthropic's alone. */
export type CallUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly webSearchRequests: number;
  readonly webFetchRequests: number;
};

/** A finished call: what it answered, sent back in the next call, its tool calls, stop and usage. */
export type CallResult = {
  readonly messages: readonly unknown[];
  readonly toolCalls: readonly ToolCall[];
  readonly stop: Stop;
  readonly usage: CallUsage;
};

/**
 * Raised when a provider's stream breaks off, says it failed, or ends in a form the adapter does not
 * read.
 */
export class StreamError extends Error {
  override name = "StreamError";
}

/** One server-sent event of a provider's stream. */
export type SseEvent = { readonly event: string; readonly data: string };

/** How a provider is called and its stream read. */
export type Adapter = {
  readonly url: string;
  readonly headers: (apiKey: string) => Record<string, string>;
  /** The opening messages: the client's turns. */
  readonly history: (turns: readonly Turn[]) => unknown[];
  readonly body: (request: {
    readonly configuration: Configuration;
    readonly system: string;
    readonly messages: readonly unknown[];
    readonly tools: readonly ToolSpec[];
  }) => unknown;
  /** The messages answering [results], appended after the call's own message. */
  readonly toolResults: (results: readonly ToolResult[]) => unknown[];
  readonly read: (
    events: AsyncIterable<SseEvent>,
    emit: (event: CallEvent) => void,
  ) => Promise<CallResult>;
};

/** The server-sent events of [body], one at a time, as the provider sent them. */
export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    let next;
    try {
      next = await reader.read();
    } catch (cause) {
      // The connection failed, or the call was aborted.
      throw new StreamError("the stream broke off", { cause });
    }
    if (next.done) return;
    buffer += next.value.replace(/\r\n?/g, "\n");
    let end;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (data.length > 0) yield { event, data: data.join("\n") };
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

function parseInput(text: string): unknown {
  try {
    return text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    return null;
  }
}

function parsed(data: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new StreamError("the stream sent an event that is not JSON");
  }
  if (!isRecord(value)) {
    throw new StreamError("the stream sent an event that is not an object");
  }
  return value;
}

// OpenAI's chat completions.

function chatTools(tools: readonly ToolSpec[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

async function readChat(
  events: AsyncIterable<SseEvent>,
  emit: (event: CallEvent) => void,
): Promise<CallResult> {
  let text = "";
  const calls: { id: string; name: string; args: string }[] = [];
  let finish: unknown = null;
  let usage: CallUsage = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    webSearchRequests: 0,
    webFetchRequests: 0,
  };
  for await (const { data } of events) {
    if (data.trim() === "[DONE]") break;
    const chunk = parsed(data);
    if (chunk.error !== undefined) {
      throw new StreamError("the provider reported an error");
    }
    if (isRecord(chunk.usage)) {
      const u = chunk.usage;
      const details = isRecord(u.completion_tokens_details)
        ? u.completion_tokens_details
        : {};
      usage = {
        inputTokens: count(u.prompt_tokens),
        outputTokens: count(u.completion_tokens),
        reasoningTokens: count(details.reasoning_tokens),
        webSearchRequests: 0,
        webFetchRequests: 0,
      };
    }
    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
    if (!isRecord(choice)) continue;
    if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
      finish = choice.finish_reason;
    }
    const delta = isRecord(choice.delta) ? choice.delta : {};
    if (typeof delta.content === "string" && delta.content !== "") {
      text += delta.content;
      emit({ kind: "text", delta: delta.content });
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const part of delta.tool_calls) {
        if (!isRecord(part)) continue;
        const index = typeof part.index === "number"
          ? part.index
          : calls.length;
        const fn = isRecord(part.function) ? part.function : {};
        const call = calls[index] ??
          (calls[index] = { id: "", name: "", args: "" });
        if (typeof part.id === "string") call.id = part.id;
        if (typeof fn.name === "string") call.name += fn.name;
        if (typeof fn.arguments === "string") call.args += fn.arguments;
      }
    }
  }
  if (finish === null) {
    throw new StreamError("the stream ended before the call finished");
  }
  const made = calls.filter((call) => call !== undefined);
  const toolCalls = made.map((call) => ({
    id: call.id,
    name: call.name,
    input: parseInput(call.args),
  }));
  return {
    messages: [{
      role: "assistant",
      content: text === "" ? null : text,
      ...(made.length === 0 ? {} : {
        tool_calls: made.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.args },
        })),
      }),
    }],
    toolCalls,
    stop: finish === "length"
      ? "cut"
      : toolCalls.length > 0
      ? "tool_use"
      : "end",
    usage,
  };
}

// OpenRouter's responses, whose reference documents the web search server tool's output item as a
// type of its own, apart from function calls (ADR 0190).

async function readResponses(
  events: AsyncIterable<SseEvent>,
  emit: (event: CallEvent) => void,
): Promise<CallResult> {
  let ended: { response: Record<string, unknown>; cut: boolean } | null = null;
  for await (const { data } of events) {
    if (data.trim() === "[DONE]") break;
    const event = parsed(data);
    switch (event.type) {
      case "error":
      case "response.failed":
        throw new StreamError("the provider reported an error");
      case "response.output_text.delta":
        if (typeof event.delta === "string" && event.delta !== "") {
          emit({ kind: "text", delta: event.delta });
        }
        break;
      case "response.output_text.annotation.added": {
        const note = isRecord(event.annotation) ? event.annotation : {};
        if (note.type === "url_citation" && typeof note.url === "string") {
          emit({
            kind: "citation",
            url: note.url,
            title: typeof note.title === "string" ? note.title : null,
          });
        }
        break;
      }
      case "response.completed":
      case "response.incomplete":
        if (isRecord(event.response)) {
          ended = {
            response: event.response,
            cut: event.type === "response.incomplete",
          };
        }
        break;
    }
  }
  if (ended === null || !Array.isArray(ended.response.output)) {
    throw new StreamError("the stream ended before the response did");
  }
  const output: unknown[] = ended.response.output;
  // A server tool's item, such as openrouter:web_search, has a type of its own: only a function
  // call is the function's to run.
  const toolCalls = output.flatMap((item) =>
    isRecord(item) && item.type === "function_call" &&
      typeof item.call_id === "string" && typeof item.name === "string"
      ? [{
        id: item.call_id,
        name: item.name,
        input: parseInput(
          typeof item.arguments === "string" ? item.arguments : "",
        ),
      }]
      : []
  );
  const u = isRecord(ended.response.usage) ? ended.response.usage : {};
  const details = isRecord(u.output_tokens_details)
    ? u.output_tokens_details
    : {};
  const tools = isRecord(u.server_tool_use_details)
    ? u.server_tool_use_details
    : {};
  return {
    messages: output,
    toolCalls,
    stop: ended.cut ? "cut" : toolCalls.length > 0 ? "tool_use" : "end",
    usage: {
      inputTokens: count(u.input_tokens),
      outputTokens: count(u.output_tokens),
      reasoningTokens: count(details.reasoning_tokens),
      webSearchRequests: count(tools.web_search_requests),
      webFetchRequests: 0,
    },
  };
}

const bearer = (apiKey: string) => ({
  "Authorization": `Bearer ${apiKey}`,
  "Content-Type": "application/json",
});

const openrouter: Adapter = {
  url: OPENROUTER_URL,
  headers: bearer,
  history: (turns) =>
    turns.map((turn) => ({ role: turn.role, content: turn.text })),
  body: ({ configuration, system, messages, tools }) => ({
    model: configuration.model,
    instructions: system,
    input: messages,
    tools: [
      ...tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
      // OpenRouter's server tool, on the Exa engine the owner's cost figure names (#713).
      ...(configuration.webSearch
        ? [{
          type: "openrouter:web_search",
          parameters: { engine: "exa", max_uses: configuration.maxSearches },
        }]
        : []),
    ],
    reasoning: { effort: configuration.effort },
    max_output_tokens: MAX_OUTPUT_TOKENS,
    stream: true,
  }),
  toolResults: (results) =>
    results.map((result) => ({
      type: "function_call_output",
      call_id: result.call.id,
      output: result.content,
    })),
  read: readResponses,
};

// OpenAI's chat completions have no native web search, so a configuration on it searches nothing.
const openai: Adapter = {
  url: OPENAI_URL,
  headers: bearer,
  history: (turns) =>
    turns.map((turn) => ({ role: turn.role, content: turn.text })),
  body: ({ configuration, system, messages, tools }) => ({
    model: configuration.model,
    messages: [{ role: "system", content: system }, ...messages],
    tools: chatTools(tools),
    ...(configuration.effort === "none"
      ? {}
      : { reasoning_effort: configuration.effort }),
    max_completion_tokens: MAX_OUTPUT_TOKENS,
    stream: true,
    stream_options: { include_usage: true },
  }),
  toolResults: (results) =>
    results.map((result) => ({
      role: "tool",
      tool_call_id: result.call.id,
      content: result.content,
    })),
  read: readChat,
};

// Anthropic's messages.

async function readAnthropic(
  events: AsyncIterable<SseEvent>,
  emit: (event: CallEvent) => void,
): Promise<CallResult> {
  const blocks: Record<string, unknown>[] = [];
  const partial = new Map<number, string>();
  let stop: unknown = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let thinkingTokens = 0;
  let searches = 0;
  let fetches = 0;
  let ended = false;
  for await (const { data } of events) {
    const event = parsed(data);
    switch (event.type) {
      case "error":
        throw new StreamError("the provider reported an error");
      case "message_start": {
        const usage = isRecord(event.message) && isRecord(event.message.usage)
          ? event.message.usage
          : {};
        inputTokens = count(usage.input_tokens) +
          count(usage.cache_read_input_tokens) +
          count(usage.cache_creation_input_tokens);
        outputTokens = count(usage.output_tokens);
        break;
      }
      case "content_block_start": {
        if (typeof event.index !== "number" || !isRecord(event.content_block)) {
          break;
        }
        const block = { ...event.content_block };
        if (block.type === "tool_use" || block.type === "server_tool_use") {
          partial.set(event.index, "");
        }
        blocks[event.index] = block;
        break;
      }
      case "content_block_delta": {
        const block = typeof event.index === "number"
          ? blocks[event.index]
          : undefined;
        const delta = isRecord(event.delta) ? event.delta : {};
        if (block === undefined) break;
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          block.text = `${
            typeof block.text === "string" ? block.text : ""
          }${delta.text}`;
          emit({ kind: "text", delta: delta.text });
        } else if (
          delta.type === "input_json_delta" &&
          typeof delta.partial_json === "string"
        ) {
          const index = event.index as number;
          partial.set(
            index,
            `${partial.get(index) ?? ""}${delta.partial_json}`,
          );
        } else if (
          delta.type === "thinking_delta" && typeof delta.thinking === "string"
        ) {
          block.thinking = `${
            typeof block.thinking === "string" ? block.thinking : ""
          }${delta.thinking}`;
        } else if (
          delta.type === "signature_delta" &&
          typeof delta.signature === "string"
        ) {
          block.signature = delta.signature;
        } else if (
          delta.type === "citations_delta" && isRecord(delta.citation)
        ) {
          const citation = delta.citation;
          block.citations = [
            ...(Array.isArray(block.citations) ? block.citations : []),
            citation,
          ];
          if (typeof citation.url === "string") {
            emit({
              kind: "citation",
              url: citation.url,
              title: typeof citation.title === "string" ? citation.title : null,
            });
          }
        }
        break;
      }
      case "message_delta": {
        if (
          isRecord(event.delta) && typeof event.delta.stop_reason === "string"
        ) {
          stop = event.delta.stop_reason;
        }
        const usage = isRecord(event.usage) ? event.usage : {};
        // These counts are cumulative over the message.
        if (usage.output_tokens !== undefined) {
          outputTokens = count(usage.output_tokens);
        }
        if (usage.input_tokens !== undefined) {
          inputTokens = count(usage.input_tokens) +
            count(usage.cache_read_input_tokens) +
            count(usage.cache_creation_input_tokens);
        }
        // Thinking's share of the output tokens, sent on the final message_delta.
        if (isRecord(usage.output_tokens_details)) {
          thinkingTokens = count(usage.output_tokens_details.thinking_tokens);
        }
        if (isRecord(usage.server_tool_use)) {
          searches = count(usage.server_tool_use.web_search_requests);
          fetches = count(usage.server_tool_use.web_fetch_requests);
        }
        break;
      }
      case "message_stop":
        ended = true;
        break;
    }
  }
  if (!ended || stop === null) {
    throw new StreamError("the stream ended before the message did");
  }
  for (const [index, json] of partial) {
    const block = blocks[index];
    if (block !== undefined) block.input = parseInput(json) ?? {};
  }
  const toolCalls = [...partial.keys()].flatMap((index) => {
    const block = blocks[index];
    return block?.type === "tool_use" && typeof block.id === "string" &&
        typeof block.name === "string"
      ? [{
        id: block.id,
        name: block.name,
        input: parseInput(partial.get(index) ?? ""),
      }]
      : [];
  });
  return {
    messages: [{
      role: "assistant",
      content: blocks.filter((block) => block !== undefined),
    }],
    toolCalls,
    stop: stop === "tool_use"
      ? "tool_use"
      : stop === "pause_turn"
      ? "pause"
      : stop === "max_tokens"
      ? "cut"
      : "end",
    usage: {
      inputTokens,
      outputTokens,
      reasoningTokens: thinkingTokens,
      webSearchRequests: searches,
      webFetchRequests: fetches,
    },
  };
}

/**
 * How thinking is turned off on [model], by Anthropic's per-model table: Claude Sonnet 5.5 takes
 * `between_tools` in place of `disabled`. A model whose thinking is always on is refused at `none`
 * when its configuration is saved (`private.assistant_effort_fits`).
 */
function thinkingOff(model: string): { type: "disabled" | "between_tools" } {
  return {
    type: model.startsWith("claude-sonnet-5-5") ? "between_tools" : "disabled",
  };
}

const anthropic: Adapter = {
  url: ANTHROPIC_URL,
  headers: (apiKey) => ({
    "x-api-key": apiKey,
    "anthropic-version": "2026-10-21",
    "Content-Type": "application/json",
  }),
  history: (turns) =>
    turns.map((turn) => ({ role: turn.role, content: turn.text })),
  body: ({ configuration, system, messages, tools }) => ({
    model: configuration.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages,
    tools: [
      ...tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      })),
      // The basic variants, which every current model takes. Web fetch reads a URL of the user's or
      // of a search's, never one a tool of the function's answered, which the model may have written.
      ...(configuration.webSearch
        ? [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: configuration.maxSearches,
          },
          {
            type: "web_fetch_20250910",
            name: "web_fetch",
            max_uses: configuration.maxSearches,
            max_content_tokens: MAX_FETCH_TOKENS,
            url_sources: { client_tool_results: { type: "none" } },
          },
        ]
        : []),
    ],
    ...(configuration.effort === "none"
      ? { thinking: thinkingOff(configuration.model) }
      : {
        thinking: { type: "adaptive" },
        output_config: { effort: configuration.effort },
      }),
    stream: true,
  }),
  toolResults: (results) => [{
    role: "user",
    content: results.map((result) => ({
      type: "tool_result",
      tool_use_id: result.call.id,
      content: result.content,
      is_error: result.isError,
    })),
  }],
  read: readAnthropic,
};

export const ADAPTERS: Readonly<Record<Provider, Adapter>> = {
  openrouter,
  openai,
  anthropic,
};
