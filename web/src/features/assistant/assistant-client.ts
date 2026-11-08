import { type CommitResult, commitProposal } from "./commit-proposal";
import type { RequestTurn } from "./conversation";
import { readEvents } from "./event-stream";
import {
  type AssistantEvent,
  type Proposal,
  parseEvent,
  parseRefusal,
  type SendRefusal,
} from "./protocol";

export type { CommitResult };

/** A message: the turns, oldest first, the last the user's. */
export type MessageRequest = { messages: RequestTurn[] };

/** A started message's events, a known event's malformed data among them; or why it did not start. */
export type SendResult =
  | { kind: "stream"; events: AsyncIterable<AssistantEvent | "malformed"> }
  | { kind: "refused"; refusal: SendRefusal };

/**
 * What the chat asks of the assistant: a seam, so its tests stand a fake in for the function. A
 * send aborted through its signal rejects, or ends its events, with an `AbortError`.
 */
export type AssistantClient = {
  send: (request: MessageRequest, signal: AbortSignal) => Promise<SendResult>;
  commit: (proposal: Proposal, checked: Record<string, string[]>) => Promise<CommitResult>;
};

async function* eventsOf(body: ReadableStream<Uint8Array>) {
  for await (const raw of readEvents(body)) {
    const event = parseEvent(raw.name, raw.data);
    if (event !== "unknown") yield event;
  }
}

/** The assistant through this app's `/api/assistant` route and its commit action. */
export const httpAssistantClient: AssistantClient = {
  async send(request, signal) {
    let response: Response;
    try {
      response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal,
      });
    } catch (cause) {
      if (signal.aborted) throw cause;
      return { kind: "refused", refusal: { kind: "unreachable" } };
    }
    if (response.status === 200 && response.body)
      return { kind: "stream", events: eventsOf(response.body) };
    const body: unknown = await response.json().catch(() => null);
    return { kind: "refused", refusal: parseRefusal(response.status, body) };
  },
  commit: (proposal, checked) => commitProposal(proposal, checked),
};
