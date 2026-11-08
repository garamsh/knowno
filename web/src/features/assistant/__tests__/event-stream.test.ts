import { describe, expect, it } from "vitest";

import { readEvents } from "../event-stream";

/** A body that arrives in [chunks], each as one read. */
function body(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function all(chunks: string[]) {
  const events = [];
  for await (const event of readEvents(body(chunks))) events.push(event);
  return events;
}

describe("reading a message's event stream", () => {
  it("yields each event once its blank line arrives, whatever chunks split it", async () => {
    const whole = 'event: text\ndata: {"delta":"안녕"}\n\nevent: usage\ndata: {"a":1}\n\n';
    const expected = [
      { name: "text", data: '{"delta":"안녕"}' },
      { name: "usage", data: '{"a":1}' },
    ];
    expect(await all([whole])).toEqual(expected);
    // Split at every character, a three-byte syllable's bytes included.
    const bytes = new TextEncoder().encode(whole);
    const split = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const events = [];
    for await (const event of readEvents(split)) events.push(event);
    expect(events).toEqual(expected);
  });

  it("reads CRLF line ends, a CRLF split across chunks among them, as one line end", async () => {
    expect(await all(["event: text\r", "\ndata: {}\r\n\r", "\n"])).toEqual([
      { name: "text", data: "{}" },
    ]);
  });

  it("joins data lines, skips comments, names an unnamed event message, and drops one cut off", async () => {
    expect(await all([": keep-alive\n\ndata: a\ndata: b\n\nevent: text\ndata: cut"])).toEqual([
      { name: "message", data: "a\nb" },
    ]);
  });
});
