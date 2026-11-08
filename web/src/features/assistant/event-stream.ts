/** A server-sent event as it arrived: its name, `message` where none was given, and its data. */
export type RawEvent = { name: string; data: string };

/**
 * The events of a `text/event-stream` [body], each yielded once its blank line arrives, whatever
 * chunks split it; an event cut off by the stream's end is dropped, as a browser's EventSource
 * drops it.
 */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<RawEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let name = "";
  let data: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end = buffer.search(/\r\n|\r|\n/u);
      // A CR at the chunk's end may be the first half of a CRLF the next chunk ends.
      while (end !== -1 && !(end === buffer.length - 1 && buffer.endsWith("\r"))) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + (buffer.startsWith("\r\n", end) ? 2 : 1));
        if (line === "") {
          if (data.length > 0) yield { name: name || "message", data: data.join("\n") };
          name = "";
          data = [];
        } else if (!line.startsWith(":")) {
          const colon = line.indexOf(":");
          const field = colon === -1 ? line : line.slice(0, colon);
          const raw = colon === -1 ? "" : line.slice(colon + 1);
          const value = raw.startsWith(" ") ? raw.slice(1) : raw;
          if (field === "event") name = value;
          else if (field === "data") data.push(value);
        }
        end = buffer.search(/\r\n|\r|\n/u);
      }
    }
  } finally {
    // A consumer that stops early, or a stream that ends, releases the connection.
    await reader.cancel().catch(() => undefined);
  }
}
