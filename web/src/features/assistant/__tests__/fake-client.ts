import type {
  AssistantClient,
  JobPoll,
  MessageRequest,
  PreparedPhoto,
  SendResult,
} from "../assistant-client";
import type { CommitResult } from "../commit-proposal";
import type { AssistantEvent, Proposal, SendRefusal } from "../protocol";

export const proposal: Proposal = {
  id: "p1",
  kind: "cards",
  deck: { id: null, name: "영단어" },
  groups: [
    {
      id: "g1",
      title: "1단원",
      format: "senses",
      cards: [
        { id: "c1", card: { front: "apple", back: "사과" } },
        { id: "c2", card: { front: "pear", back: "배" } },
      ],
    },
    {
      id: "g2",
      title: "2단원",
      format: "senses",
      cards: [{ id: "c3", card: { front: "plum", back: "자두" } }],
    },
  ],
};

export const usage = (tokensUsed: number, atLimit = false): AssistantEvent => ({
  type: "usage",
  allowance: { tokenBudget: 200000, tokensUsed },
  atLimit,
});

/** A reply's events, each held until [gate] lets it through; an abort ends them with an AbortError. */
export function stream(
  events: AssistantEvent[],
  signal: AbortSignal,
  gate?: Promise<void>,
): SendResult {
  async function* events_() {
    for (const event of events) {
      if (gate) await gate;
      yield event;
    }
    if (gate) {
      await new Promise<void>((_, reject) => {
        signal.addEventListener("abort", () => {
          reject(new DOMException("stopped", "AbortError"));
        });
      });
    }
  }
  return { kind: "stream", events: events_() };
}

/**
 * The assistant, played by [replies] in order: each a reply's events or a refusal; every request
 * and commit is recorded, and a commit answers [committed].
 */
export function fakeClient(
  replies: (AssistantEvent[] | SendRefusal | ((signal: AbortSignal) => SendResult))[],
  committed: CommitResult = {
    kind: "added",
    deck: { id: "d1", name: "영단어" },
    count: 2,
    skipped: 0,
    refused: 0,
  },
  photos: { stored?: boolean; polls?: JobPoll[]; cancelled?: boolean } = {},
) {
  const requests: MessageRequest[] = [];
  const commits: unknown[] = [];
  const uploads: PreparedPhoto[][] = [];
  const asked: string[] = [];
  const cancels: string[] = [];
  const polls = [...(photos.polls ?? [])];
  const client: AssistantClient = {
    send(request, signal) {
      requests.push(structuredClone(request));
      const reply = replies.shift();
      if (!reply) throw new Error("no reply left");
      if (typeof reply === "function") return Promise.resolve(reply(signal));
      if (!Array.isArray(reply)) return Promise.resolve({ kind: "refused", refusal: reply });
      return Promise.resolve(stream(reply, signal));
    },
    commit(shown, checked) {
      commits.push({ proposal: shown.id, checked });
      return Promise.resolve(committed);
    },
    upload(uploaded) {
      uploads.push(uploaded);
      return Promise.resolve(photos.stored ?? true);
    },
    pollJob(id) {
      asked.push(id);
      return Promise.resolve(polls.shift() ?? { kind: "failed" });
    },
    cancelJob(id) {
      cancels.push(id);
      return Promise.resolve(photos.cancelled ?? true);
    },
  };
  return { client, requests, commits, uploads, asked, cancels };
}
