// Each provider's request for a call with tools, and its stream read: web search, the search cap,
// reasoning, citations, tool calls and usage.
import assert from "node:assert/strict";
import {
  ADAPTERS,
  type CallEvent,
  type SseEvent,
  sseEvents,
  StreamError,
  type ToolSpec,
} from "./providers.ts";
import type { Configuration } from "./supabase.ts";

const TOOLS: ToolSpec[] = [{
  name: "list_decks",
  description: "Lists the decks.",
  inputSchema: { type: "object", properties: {} },
}];

function configuration(overrides: Partial<Configuration> = {}): Configuration {
  return {
    id: 1,
    provider: "openrouter",
    model: "anthropic/claude-haiku-5.5",
    promptVersionId: 1,
    prompt: "You are 말랑이.",
    webSearch: false,
    maxSearches: 3,
    effort: "none",
    ...overrides,
  };
}

function body(
  provider: Configuration["provider"],
  overrides: Partial<Configuration> = {},
) {
  return ADAPTERS[provider].body({
    configuration: configuration({ provider, ...overrides }),
    system: "You are 말랑이.",
    messages: [{ role: "user", content: "hi" }],
    tools: TOOLS,
  }) as Record<string, unknown>;
}

const toolTypes = (request: Record<string, unknown>) =>
  (request.tools as Record<string, unknown>[]).map((tool) =>
    tool.type ?? tool.name
  );

Deno.test("OpenRouter sends its web search server tool with the cap only when search is on", () => {
  const off = body("openrouter");
  assert.deepEqual(off.tools, [{
    type: "function",
    name: "list_decks",
    description: "Lists the decks.",
    parameters: { type: "object", properties: {} },
  }]);
  const on = body("openrouter", { webSearch: true, maxSearches: 4 });
  assert.deepEqual((on.tools as unknown[])[1], {
    type: "openrouter:web_search",
    parameters: { engine: "exa", max_uses: 4 },
  });
  // A responses request: the prompt as instructions, the conversation as input.
  assert.equal(on.instructions, "You are 말랑이.");
  assert.deepEqual(on.input, [{ role: "user", content: "hi" }]);
  assert.equal(on.max_output_tokens, 8192);
  assert.equal(on.stream, true);
});

Deno.test("OpenRouter sends the reasoning effort, none included", () => {
  assert.deepEqual(body("openrouter").reasoning, { effort: "none" });
  assert.deepEqual(body("openrouter", { effort: "high" }).reasoning, {
    effort: "high",
  });
});

Deno.test("OpenAI has no native search, so search on sends no search tool", () => {
  assert.deepEqual(toolTypes(body("openai", { webSearch: true })), [
    "function",
  ]);
  assert.equal("reasoning_effort" in body("openai"), false);
  assert.equal(body("openai", { effort: "low" }).reasoning_effort, "low");
});

Deno.test("Anthropic sends web search and web fetch with the cap only when search is on", () => {
  assert.deepEqual(toolTypes(body("anthropic")), ["list_decks"]);
  const on = body("anthropic", { webSearch: true, maxSearches: 2 });
  assert.deepEqual((on.tools as unknown[]).slice(1), [
    { type: "web_search_20250305", name: "web_search", max_uses: 2 },
    {
      type: "web_fetch_20250910",
      name: "web_fetch",
      max_uses: 2,
      max_content_tokens: 20_000,
      // A URL in a tool's answer is not fetched; the user's and a search's are.
      url_sources: { client_tool_results: { type: "none" } },
    },
  ]);
});

Deno.test("Anthropic turns thinking off at none and adaptive with the effort otherwise", () => {
  const none = body("anthropic", { model: "claude-haiku-5-5" });
  assert.deepEqual(none.thinking, { type: "disabled" });
  assert.equal("output_config" in none, false);
  // Claude Sonnet 5.5 refuses disabled and turns up-front thinking off with between_tools.
  assert.deepEqual(body("anthropic", { model: "claude-sonnet-5-5" }).thinking, {
    type: "between_tools",
  });
  const medium = body("anthropic", { effort: "medium" });
  assert.deepEqual(medium.thinking, { type: "adaptive" });
  assert.deepEqual(medium.output_config, { effort: "medium" });
});

async function* events(...items: SseEvent[]): AsyncGenerator<SseEvent> {
  for (const item of items) yield item;
}

const data = (value: unknown): SseEvent => ({
  event: "message",
  data: JSON.stringify(value),
});

Deno.test("a chat stream's text, tool call pieces and reasoning tokens are read", async () => {
  const seen: CallEvent[] = [];
  const result = await ADAPTERS.openai.read(
    events(
      data({ choices: [{ delta: { content: "잠시만요" } }] }),
      data({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: "c1",
              function: { name: "list_", arguments: '{"a"' },
            }],
          },
        }],
      }),
      data({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { name: "decks", arguments: ":1}" },
            }],
          },
        }],
      }),
      data({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      data({
        choices: [],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 30,
          completion_tokens_details: { reasoning_tokens: 12 },
        },
      }),
      { event: "message", data: "[DONE]" },
    ),
    (event) => seen.push(event),
  );
  assert.deepEqual(seen, [{ kind: "text", delta: "잠시만요" }]);
  assert.deepEqual(result.toolCalls, [{
    id: "c1",
    name: "list_decks",
    input: { a: 1 },
  }]);
  assert.equal(result.stop, "tool_use");
  assert.deepEqual(result.usage, {
    inputTokens: 50,
    outputTokens: 30,
    reasoningTokens: 12,
    webSearchRequests: 0,
    webFetchRequests: 0,
  });
  assert.deepEqual(result.messages, [{
    role: "assistant",
    content: "잠시만요",
    tool_calls: [{
      id: "c1",
      type: "function",
      function: { name: "list_decks", arguments: '{"a":1}' },
    }],
  }]);
});

Deno.test("a chat stream that ends before it finishes is an error, against one that finishes", async () => {
  await assert.rejects(
    ADAPTERS.openai.read(
      events(data({ choices: [{ delta: { content: "hi" } }] })),
      () => {},
    ),
    StreamError,
  );
  const done = await ADAPTERS.openai.read(
    events(
      data({ choices: [{ delta: { content: "hi" }, finish_reason: "stop" }] }),
    ),
    () => {},
  );
  assert.equal(done.stop, "end");
});

Deno.test("an Anthropic stream's citations, tool input, thinking and searches are read", async () => {
  const seen: CallEvent[] = [];
  const result = await ADAPTERS.anthropic.read(
    events(
      data({
        type: "message_start",
        message: { usage: { input_tokens: 80, output_tokens: 1 } },
      }),
      data({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      }),
      data({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "hmm" },
      }),
      data({
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "sig" },
      }),
      data({ type: "content_block_stop", index: 0 }),
      data({
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" },
      }),
      data({
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "서울이에요" },
      }),
      data({
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "citations_delta",
          citation: {
            type: "web_search_result_location",
            url: "https://example.com/s",
            title: "S",
            cited_text: "…",
          },
        },
      }),
      data({ type: "content_block_stop", index: 1 }),
      data({
        type: "content_block_start",
        index: 2,
        content_block: {
          type: "tool_use",
          id: "toolu_1",
          name: "list_cards",
          input: {},
        },
      }),
      data({
        type: "content_block_delta",
        index: 2,
        delta: { type: "input_json_delta", partial_json: '{"deck_' },
      }),
      data({
        type: "content_block_delta",
        index: 2,
        delta: { type: "input_json_delta", partial_json: 'id":"x"}' },
      }),
      data({ type: "content_block_stop", index: 2 }),
      data({
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: {
          output_tokens: 40,
          output_tokens_details: { thinking_tokens: 25 },
          server_tool_use: { web_search_requests: 1, web_fetch_requests: 2 },
        },
      }),
      data({ type: "message_stop" }),
    ),
    (event) => seen.push(event),
  );
  assert.deepEqual(seen, [
    { kind: "text", delta: "서울이에요" },
    { kind: "citation", url: "https://example.com/s", title: "S" },
  ]);
  assert.deepEqual(result.toolCalls, [{
    id: "toolu_1",
    name: "list_cards",
    input: { deck_id: "x" },
  }]);
  assert.equal(result.stop, "tool_use");
  assert.deepEqual(result.usage, {
    inputTokens: 80,
    outputTokens: 40,
    reasoningTokens: 25,
    webSearchRequests: 1,
    webFetchRequests: 2,
  });
  // The thinking block goes back with its signature, as the next call requires.
  const content =
    (result.messages[0] as { content: Record<string, unknown>[] }).content;
  assert.deepEqual(content[0], {
    type: "thinking",
    thinking: "hmm",
    signature: "sig",
  });
  assert.deepEqual(content[2], {
    type: "tool_use",
    id: "toolu_1",
    name: "list_cards",
    input: { deck_id: "x" },
  });
});

Deno.test("an Anthropic pause is read as a pause, and an error event fails the call", async () => {
  const paused = await ADAPTERS.anthropic.read(
    events(
      data({ type: "message_start", message: { usage: { input_tokens: 1 } } }),
      data({
        type: "message_delta",
        delta: { stop_reason: "pause_turn" },
        usage: { output_tokens: 1 },
      }),
      data({ type: "message_stop" }),
    ),
    () => {},
  );
  assert.equal(paused.stop, "pause");
  await assert.rejects(
    ADAPTERS.anthropic.read(
      events(data({ type: "error", error: { type: "overloaded_error" } })),
      () => {},
    ),
    StreamError,
  );
});

Deno.test("server-sent events are split across chunks as the provider sent them", async () => {
  const chunks = ["event: a\nda", 'ta: {"x":1}\n\ndata: two\r\n', "\r\n"];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
  const read: SseEvent[] = [];
  for await (const event of sseEvents(stream)) read.push(event);
  assert.deepEqual(read, [{ event: "a", data: '{"x":1}' }, {
    event: "message",
    data: "two",
  }]);
});

Deno.test("a responses stream's text, citations, function calls and usage are read, a server tool's item run by none", async () => {
  const seen: CallEvent[] = [];
  const search = {
    type: "openrouter:web_search",
    id: "ws_1",
    status: "completed",
    action: { type: "search", query: "서울" },
  };
  const call = {
    type: "function_call",
    id: "fc_1",
    call_id: "call_1",
    name: "list_decks",
    arguments: '{"a":1}',
  };
  const result = await ADAPTERS.openrouter.read(
    events(
      data({ type: "response.output_item.added", item: search }),
      data({ type: "response.output_item.done", item: search }),
      data({ type: "response.output_text.delta", delta: "서울이에요" }),
      data({
        type: "response.output_text.annotation.added",
        annotation: {
          type: "url_citation",
          url: "https://example.com/s",
          title: "S",
        },
      }),
      data({
        type: "response.completed",
        response: {
          status: "completed",
          output: [search, call],
          usage: {
            input_tokens: 50,
            output_tokens: 30,
            output_tokens_details: { reasoning_tokens: 12 },
            server_tool_use_details: { web_search_requests: 1 },
          },
        },
      }),
      { event: "message", data: "[DONE]" },
    ),
    (event) => seen.push(event),
  );
  assert.deepEqual(seen, [
    { kind: "text", delta: "서울이에요" },
    { kind: "citation", url: "https://example.com/s", title: "S" },
  ]);
  assert.deepEqual(result.toolCalls, [{
    id: "call_1",
    name: "list_decks",
    input: { a: 1 },
  }]);
  assert.equal(result.stop, "tool_use");
  assert.deepEqual(result.usage, {
    inputTokens: 50,
    outputTokens: 30,
    reasoningTokens: 12,
    webSearchRequests: 1,
    webFetchRequests: 0,
  });
  // Every output item goes back as the response gave it, the search's included.
  assert.deepEqual(result.messages, [search, call]);
});

Deno.test("a responses call of server tools alone ends its turn, against one calling a function", async () => {
  const done = (output: unknown[]) =>
    ADAPTERS.openrouter.read(
      events(data({
        type: "response.completed",
        response: { status: "completed", output, usage: {} },
      })),
      () => {},
    );
  const searched = await done([{
    type: "openrouter:web_search",
    id: "ws_1",
    status: "completed",
    action: { type: "search", query: "q" },
  }]);
  assert.deepEqual(searched.toolCalls, []);
  assert.equal(searched.stop, "end");
  const called = await done([{
    type: "function_call",
    id: "fc_1",
    call_id: "call_1",
    name: "list_decks",
    arguments: "{}",
  }]);
  assert.equal(called.stop, "tool_use");
});

Deno.test("a responses stream cut short is read as cut, and a failed or unfinished one is an error", async () => {
  const cut = await ADAPTERS.openrouter.read(
    events(data({
      type: "response.incomplete",
      response: {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
        usage: {},
      },
    })),
    () => {},
  );
  assert.equal(cut.stop, "cut");
  await assert.rejects(
    ADAPTERS.openrouter.read(
      events(data({ type: "response.failed", response: { output: [] } })),
      () => {},
    ),
    StreamError,
  );
  await assert.rejects(
    ADAPTERS.openrouter.read(
      events(data({ type: "response.output_text.delta", delta: "hi" })),
      () => {},
    ),
    StreamError,
  );
});

Deno.test("a body that breaks off is a stream error, after the events it sent", async () => {
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulls++ === 0) {
        controller.enqueue(new TextEncoder().encode('data: {"x":1}\n\n'));
      } else {
        controller.error(new TypeError("error reading a body from connection"));
      }
    },
  });
  const read: SseEvent[] = [];
  await assert.rejects(
    (async () => {
      for await (const event of sseEvents(stream)) read.push(event);
    })(),
    StreamError,
  );
  assert.deepEqual(read, [{ event: "message", data: '{"x":1}' }]);
});
