/**
 * How one streamed model call with tools is sent to each provider and its stream read (ADR 0190):
 * OpenRouter's and OpenAI's chat completions and Anthropic's messages, each with its own native
 * web search, reasoning setting and usage.
 */

import type { Configuration, Provider } from "./supabase.ts";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/** The most tokens one call may answer with. */
export const MAX_OUTPUT_TOKENS = 8192;

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

/** What one call used, as its provider reports it. */
export type CallUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly webSearchRequests: number;
};

/** A finished call: its message to send back in the next call, its tool calls, stop and usage. */
export type CallResult = {
  readonly message: unknown;
  readonly toolCalls: readonly ToolCall[];
  readonly stop: Stop;
  readonly usage: CallUsage;
};

/** Raised when a provider's stream says it failed or ends in a form the adapter does not read. */
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
  let buffer = "";
  for await (const chunk of body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk.replace(/\r\n?/g, "\n");
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

// Chat completions: OpenRouter and OpenAI.

function chatHistory(turns: readonly Turn[]): unknown[] {
  return turns.map((turn) => ({ role: turn.role, content: turn.text }));
}

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

function chatToolResults(results: readonly ToolResult[]): unknown[] {
  return results.map((result) => ({
    role: "tool",
    tool_call_id: result.call.id,
    content: result.content,
  }));
}

/** One reasoning detail, merged into the one before it when both continue the same index. */
function mergeReasoning(details: Record<string, unknown>[], next: unknown) {
  if (!isRecord(next)) return;
  const last = details.at(-1);
  if (
    last !== undefined && next.index !== undefined &&
    last.index === next.index &&
    last.type === next.type
  ) {
    for (const key of ["text", "summary", "data", "signature"]) {
      if (typeof next[key] === "string") {
        last[key] = `${typeof last[key] === "string" ? last[key] : ""}${
          next[key]
        }`;
      }
    }
    return;
  }
  details.push({ ...next });
}

async function readChat(
  events: AsyncIterable<SseEvent>,
  emit: (event: CallEvent) => void,
): Promise<CallResult> {
  let text = "";
  const calls: { id: string; name: string; args: string }[] = [];
  const reasoning: Record<string, unknown>[] = [];
  let finish: unknown = null;
  let usage: CallUsage = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    webSearchRequests: 0,
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
      // OpenRouter names its server tools' counts either way.
      const tools = isRecord(u.server_tool_use)
        ? u.server_tool_use
        : isRecord(u.server_tool_use_details)
        ? u.server_tool_use_details
        : {};
      usage = {
        inputTokens: count(u.prompt_tokens),
        outputTokens: count(u.completion_tokens),
        reasoningTokens: count(details.reasoning_tokens),
        webSearchRequests: count(tools.web_search_requests),
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
    if (Array.isArray(delta.reasoning_details)) {
      for (const detail of delta.reasoning_details) {
        mergeReasoning(reasoning, detail);
      }
    }
    if (Array.isArray(delta.annotations)) {
      for (const note of delta.annotations) {
        const cited = isRecord(note) && isRecord(note.url_citation)
          ? note.url_citation
          : null;
        if (cited !== null && typeof cited.url === "string") {
          emit({
            kind: "citation",
            url: cited.url,
            title: typeof cited.title === "string" ? cited.title : null,
          });
        }
      }
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
  const toolCalls = calls.filter((call) => call !== undefined).map((call) => ({
    id: call.id,
    name: call.name,
    input: parseInput(call.args),
  }));
  return {
    message: {
      role: "assistant",
      content: text === "" ? null : text,
      ...(toolCalls.length === 0 ? {} : {
        tool_calls: calls.filter((call) => call !== undefined).map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.args },
        })),
      }),
      ...(reasoning.length === 0 ? {} : { reasoning_details: reasoning }),
    },
    toolCalls,
    stop: finish === "length"
      ? "cut"
      : toolCalls.length > 0
      ? "tool_use"
      : "end",
    usage,
  };
}

const bearer = (apiKey: string) => ({
  "Authorization": `Bearer ${apiKey}`,
  "Content-Type": "application/json",
});

const openrouter: Adapter = {
  url: OPENROUTER_URL,
  headers: bearer,
  history: chatHistory,
  body: ({ configuration, system, messages, tools }) => ({
    model: configuration.model,
    messages: [{ role: "system", content: system }, ...messages],
    tools: [
      ...chatTools(tools),
      // OpenRouter's server tool, on the Exa engine the owner's cost figure names (#713).
      ...(configuration.webSearch
        ? [{
          type: "openrouter:web_search",
          parameters: { engine: "exa", max_uses: configuration.maxSearches },
        }]
        : []),
    ],
    reasoning: { effort: configuration.effort },
    max_tokens: MAX_OUTPUT_TOKENS,
    stream: true,
    stream_options: { include_usage: true },
  }),
  toolResults: chatToolResults,
  read: readChat,
};

// OpenAI's chat completions have no native web search, so a configuration on it searches nothing.
const openai: Adapter = {
  url: OPENAI_URL,
  headers: bearer,
  history: chatHistory,
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
  toolResults: chatToolResults,
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
  let searches = 0;
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
        if (isRecord(usage.server_tool_use)) {
          searches = count(usage.server_tool_use.web_search_requests);
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
    message: {
      role: "assistant",
      content: blocks.filter((block) => block !== undefined),
    },
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
      // Anthropic counts thinking within the output tokens and reports no part of its own.
      reasoningTokens: 0,
      webSearchRequests: searches,
    },
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
      // The basic variants, which every current model takes; web fetch reads a URL in the chat.
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
          },
        ]
        : []),
    ],
    ...(configuration.effort === "none" ? { thinking: { type: "disabled" } } : {
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
