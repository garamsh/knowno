import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantClient, JobPoll, SendResult } from "../assistant-client";
import { jobDoneMessage, parseConversation } from "../conversation";
import type { AssistantEvent } from "../protocol";
import { busyRetryMs, jobPollMs, useAssistantChat } from "../use-assistant-chat";
import { fakeClient, proposal, stream, usage } from "./fake-client";

// jsdom decodes no image: the preparation is design/'s own, and here gives a fixed JPEG.
vi.mock("@/design/prepare-photo", () => ({
  downscalePhoto: vi.fn((file: Blob) =>
    Promise.resolve(new File([file], "photo.jpg", { type: "image/jpeg" })),
  ),
}));

const allowance = { tokenBudget: 200000, tokensUsed: 20000 };
const browserZone = "America/New_York";
const storageKey = "knowno.assistant";

beforeEach(() => {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    timeZone: browserZone,
  } as Intl.ResolvedDateTimeFormatOptions);
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: () => "blob:photo", revokeObjectURL: () => undefined }),
  );
  window.localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function open(client: AssistantClient, readAllowance = allowance as typeof allowance | null) {
  return renderHook(() => useAssistantChat(client, readAllowance));
}
type Chat = ReturnType<typeof open>;

/** Types [text] and sends it, then waits for the reply to end. */
async function say(chat: Chat, text: string) {
  act(() => {
    chat.result.current.setDraft(text);
  });
  await act(async () => {
    await chat.result.current.submit();
  });
  await settled(chat);
}
async function settled(chat: Chat) {
  await waitFor(() => {
    expect(chat.result.current.busy).toBe(false);
  });
}
const lastTurn = (chat: Chat) => chat.result.current.turns.at(-1);
const replyOf = (chat: Chat) => {
  const turn = lastTurn(chat);
  if (turn?.role !== "assistant") throw new Error("the last turn is not a reply");
  return turn;
};

/** A reply whose events the test lets through one at a time; `end` closes the stream. */
function heldEvents() {
  const queue: (AssistantEvent | null)[] = [];
  let wake: (() => void) | null = null;
  const push = (event: AssistantEvent | null) => {
    queue.push(event);
    wake?.();
  };
  return {
    events: (signal: AbortSignal): SendResult => ({
      kind: "stream",
      events: (async function* () {
        for (;;) {
          while (queue.length === 0) {
            await new Promise<void>((resolve, reject) => {
              wake = resolve;
              signal.addEventListener("abort", () => {
                reject(new DOMException("stopped", "AbortError"));
              });
            });
          }
          const next = queue.shift();
          if (next === null || next === undefined) return;
          yield next;
        }
      })(),
    }),
    text: (delta: string) => {
      push({ type: "text", delta });
    },
    mark: () => {
      push({ type: "interim" });
    },
    end: () => {
      push(null);
    },
  };
}

/** A send whose headers are held back until [release], as the route's are while the function starts. */
function heldHeaders() {
  const fake = fakeClient([]);
  let release: (result: SendResult) => void = () => undefined;
  const client: AssistantClient = {
    ...fake.client,
    send: (_request, signal) =>
      new Promise<SendResult>((resolve, reject) => {
        release = resolve;
        signal.addEventListener("abort", () => {
          reject(new DOMException("stopped", "AbortError"));
        });
      }),
  };
  return {
    client,
    release: (result: SendResult) => {
      release(result);
    },
  };
}

describe("sending a message", () => {
  it("streams the reply in, takes the day's tokens from its usage and sends the turns with the browser's zone", async () => {
    const { client, requests } = fakeClient([
      [{ type: "text", delta: "좋아요, " }, { type: "text", delta: "만들어 볼게요" }, usage(72000)],
    ]);
    const chat = open(client);
    await say(chat, "  영단어 카드 만들어 줘 ");
    expect(replyOf(chat)).toMatchObject({ text: "좋아요, 만들어 볼게요", ending: "ok" });
    expect(chat.result.current.allowance).toEqual({ tokenBudget: 200000, tokensUsed: 72000 });
    expect(chat.result.current.draft).toBe("");
    expect(requests).toEqual([
      {
        messages: [{ role: "user", text: "영단어 카드 만들어 줘" }],
        context: { time_zone: browserZone },
      },
    ]);
  });

  it("sends no context when the browser names no zone, and the zone it names otherwise", async () => {
    const resolved = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions");
    resolved.mockReturnValue({} as Intl.ResolvedDateTimeFormatOptions);
    const none = fakeClient([[{ type: "text", delta: "네" }]]);
    await say(open(none.client), "안녕");
    expect(none.requests[0]).not.toHaveProperty("context");

    resolved.mockReturnValue({
      timeZone: "Pacific/Auckland",
    } as Intl.ResolvedDateTimeFormatOptions);
    const named = fakeClient([[{ type: "text", delta: "네" }]]);
    await say(open(named.client), "안녕");
    expect(named.requests[0]?.context).toEqual({ time_zone: "Pacific/Auckland" });
  });

  it("sends nothing for an empty message, or while one is under way", async () => {
    const turn = heldEvents();
    const { client, requests } = fakeClient([turn.events]);
    const chat = open(client);
    act(() => {
      chat.result.current.send("   ");
    });
    expect(requests).toEqual([]);
    act(() => {
      chat.result.current.send("하나");
    });
    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    act(() => {
      chat.result.current.send("둘");
    });
    expect(requests).toHaveLength(1);
    expect(chat.result.current.turns.filter((turn) => turn.role === "user")).toHaveLength(1);
    turn.end();
    await settled(chat);
  });

  it("keeps the conversation and the draft in this browser, and reads them back where it opens", async () => {
    const { client, requests } = fakeClient([[{ type: "text", delta: "좋아요" }]]);
    const chat = open(client);
    await say(chat, "카드 만들어 줘");
    act(() => {
      chat.result.current.setDraft("다음엔");
    });
    await waitFor(() => {
      expect(parseConversation(window.localStorage.getItem(storageKey) ?? "").draft).toBe("다음엔");
    });
    chat.unmount();

    const again = open(client);
    expect(again.result.current.turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
    expect(again.result.current.draft).toBe("다음엔");
    expect(requests).toHaveLength(1);
  });

  it("sends a choice's pick after the question it answers", async () => {
    const choice = { prompt: "형식", options: ["단어", "표"] };
    const { client, requests } = fakeClient([
      [
        { type: "text", delta: "어떤 형식으로 만들까요?" },
        { type: "choice", choice },
      ],
      [{ type: "text", delta: "단어로 만들게요" }],
    ]);
    const chat = open(client);
    await say(chat, "이 단원 카드로");
    act(() => {
      chat.result.current.send("단어");
    });
    await settled(chat);
    expect(requests[1]?.messages.slice(-2)).toEqual([
      { role: "assistant", text: "어떤 형식으로 만들까요?", choice },
      { role: "user", text: "단어" },
    ]);
  });
});

describe("refusals, retries and stops", () => {
  it("reads a refusal as the status, taking the day's tokens a rate limit names", async () => {
    const { client } = fakeClient([
      { kind: "rate_limited", allowance: { tokenBudget: 200000, tokensUsed: 200400 } },
    ]);
    const chat = open(client);
    await say(chat, "하나 더");
    expect(chat.result.current.status).toEqual({
      kind: "refused",
      refusal: {
        kind: "rate_limited",
        allowance: { tokenBudget: 200000, tokensUsed: 200400 },
      },
    });
    expect(chat.result.current.allowance?.tokensUsed).toBe(200400);
  });

  it("sends a message refused as busy again after a few seconds, the same request", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { client, requests } = fakeClient([
      { kind: "busy" },
      [{ type: "text", delta: "왔어요" }],
    ]);
    const chat = open(client);
    act(() => {
      chat.result.current.setDraft("안녕");
    });
    await act(async () => {
      await chat.result.current.submit();
    });
    await waitFor(() => {
      expect(chat.result.current.status.kind).toBe("waiting");
    });
    expect(requests).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(busyRetryMs);
    });
    await settled(chat);
    expect(replyOf(chat).text).toBe("왔어요");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  });

  it("gives up on busy after three resends, leaving it as the refusal", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { client, requests } = fakeClient([
      { kind: "busy" },
      { kind: "busy" },
      { kind: "busy" },
      { kind: "busy" },
    ]);
    const chat = open(client);
    act(() => {
      chat.result.current.setDraft("안녕");
    });
    await act(async () => {
      await chat.result.current.submit();
    });
    for (let wait = 0; wait < 3; wait += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(busyRetryMs);
      });
    }
    await waitFor(() => {
      expect(chat.result.current.status).toEqual({ kind: "refused", refusal: { kind: "busy" } });
    });
    expect(requests).toHaveLength(4);
  });

  it("sends the last message again in a failed reply's place on retry", async () => {
    const { client, requests } = fakeClient([
      [{ type: "error", error: "model_error" }],
      [{ type: "text", delta: "이번엔 됐어요" }],
    ]);
    const chat = open(client);
    await say(chat, "안녕");
    expect(replyOf(chat).ending).toBe("model_error");
    act(() => {
      chat.result.current.retry();
    });
    await settled(chat);
    expect(chat.result.current.turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
    expect(replyOf(chat)).toMatchObject({ text: "이번엔 됐어요", ending: "ok" });
    expect(requests[1]).toEqual({
      messages: [{ role: "user", text: "안녕" }],
      context: { time_zone: browserZone },
    });
  });

  it("ends a turn that stopped at its limit with nothing to show as limit, against one with a reply", async () => {
    const { client } = fakeClient([
      [{ type: "interim" }, usage(1000, true)],
      [{ type: "text", delta: "여기까지 찾았어요" }, usage(2000, true)],
    ]);
    const chat = open(client);
    await say(chat, "안녕");
    expect(replyOf(chat).ending).toBe("limit");
    await say(chat, "또");
    expect(replyOf(chat)).toMatchObject({ text: "여기까지 찾았어요", ending: "ok" });
  });

  it("sends the message a refusal stopped again on retryRefused", async () => {
    const { client, requests } = fakeClient([
      { kind: "unavailable" },
      [{ type: "text", delta: "이제 돼요" }],
    ]);
    const chat = open(client);
    await say(chat, "안녕");
    expect(chat.result.current.status.kind).toBe("refused");
    act(() => {
      chat.result.current.retryRefused();
    });
    await waitFor(() => {
      expect(chat.result.current.status.kind).toBe("idle");
    });
    expect(replyOf(chat).text).toBe("이제 돼요");
    expect(requests).toHaveLength(2);
  });

  it("ends a streaming reply as stopped on stop, keeping what came", async () => {
    const { client } = fakeClient([
      (signal) => stream([{ type: "text", delta: "길게 쓰는 중" }], signal, Promise.resolve()),
    ]);
    const chat = open(client);
    act(() => {
      chat.result.current.send("길게");
    });
    await waitFor(() => {
      expect(replyOf(chat).text).toBe("길게 쓰는 중");
    });
    act(() => {
      chat.result.current.stop();
    });
    await settled(chat);
    expect(replyOf(chat)).toMatchObject({ text: "길게 쓰는 중", ending: "stopped" });
  });

  it("aborts a reply still streaming when the chat is left", async () => {
    const turn = heldEvents();
    let signal: AbortSignal | undefined;
    const { client } = fakeClient([
      (given) => {
        signal = given;
        return turn.events(given);
      },
    ]);
    const chat = open(client);
    act(() => {
      chat.result.current.send("길게");
    });
    await waitFor(() => {
      expect(signal).toBeDefined();
    });
    expect(signal?.aborted).toBe(false);
    chat.unmount();
    expect(signal?.aborted).toBe(true);
  });
});

describe("the typing state", () => {
  it("is on from the send, while the route's headers are pending, and off on the first text", async () => {
    const { client, release } = heldHeaders();
    const chat = open(client);
    expect(chat.result.current.typing).toBe(false);
    act(() => {
      chat.result.current.send("안녕");
    });
    // No reply turn exists yet: the state is drawn from the status and the user's turn.
    expect(chat.result.current.turns.at(-1)?.role).toBe("user");
    expect(chat.result.current.typing).toBe(true);
    await act(async () => {
      release(stream([{ type: "text", delta: "네" }], new AbortController().signal));
      await Promise.resolve();
    });
    await settled(chat);
    expect(chat.result.current.typing).toBe(false);
  });

  it("is on for a reply that has begun without text, and off once its text came", async () => {
    const turn = heldEvents();
    const { client } = fakeClient([turn.events]);
    const chat = open(client);
    act(() => {
      chat.result.current.send("안녕");
    });
    await waitFor(() => {
      expect(chat.result.current.turns.at(-1)?.role).toBe("assistant");
    });
    expect(chat.result.current.typing).toBe(true);
    act(() => {
      turn.text("안녕");
    });
    await waitFor(() => {
      expect(chat.result.current.typing).toBe(false);
    });
    turn.end();
    await settled(chat);
  });

  it("is on while a busy message waits to be sent again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { client } = fakeClient([{ kind: "busy" }, [{ type: "text", delta: "왔어요" }]]);
    const chat = open(client);
    act(() => {
      chat.result.current.send("안녕");
    });
    await waitFor(() => {
      expect(chat.result.current.status.kind).toBe("waiting");
    });
    expect(chat.result.current.typing).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(busyRetryMs);
    });
    await settled(chat);
  });

  it("is off on a refusal", async () => {
    const { client, release } = heldHeaders();
    const chat = open(client);
    act(() => {
      chat.result.current.send("안녕");
    });
    expect(chat.result.current.typing).toBe(true);
    await act(async () => {
      release({ kind: "refused", refusal: { kind: "unavailable" } });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(chat.result.current.status.kind).toBe("refused");
    });
    expect(chat.result.current.typing).toBe(false);
  });

  it("is off on stop, for a reply that never began", async () => {
    const { client } = heldHeaders();
    const chat = open(client);
    act(() => {
      chat.result.current.send("안녕");
    });
    expect(chat.result.current.typing).toBe(true);
    act(() => {
      chat.result.current.stop();
    });
    await waitFor(() => {
      expect(chat.result.current.typing).toBe(false);
    });
    expect(chat.result.current.status.kind).toBe("idle");
  });
});

describe("a reply's interim line", () => {
  it("holds the text before each mark folded, replaced by the next, gone when the reply's text begins, never stored or sent", async () => {
    const turn = heldEvents();
    const { client, requests } = fakeClient([turn.events, [{ type: "text", delta: "네" }]]);
    const chat = open(client);
    act(() => {
      chat.result.current.send("카드 만들어 줘");
    });
    await waitFor(() => {
      expect(chat.result.current.status.kind).toBe("streaming");
    });
    act(() => {
      turn.text("**노트**를\n찾아볼게요");
      turn.mark();
    });
    await waitFor(() => {
      expect(replyOf(chat).interim).toBe("**노트**를 찾아볼게요");
    });
    expect(replyOf(chat).text).toBe("");

    act(() => {
      turn.text("\n\n");
      turn.text("카드를 만들게요");
      turn.mark();
    });
    await waitFor(() => {
      expect(replyOf(chat).interim).toBe("카드를 만들게요");
    });

    act(() => {
      turn.text("\n\n");
      turn.text("**다 됐어요**");
    });
    await waitFor(() => {
      expect(replyOf(chat).text).toBe("**다 됐어요**");
    });
    expect(replyOf(chat).interim).toBeNull();
    turn.end();
    await settled(chat);

    const stored = window.localStorage.getItem(storageKey) ?? "";
    expect(stored).not.toMatch(/찾아볼게요|만들게요/);
    await say(chat, "고마워");
    expect(requests[1]?.messages.at(-2)).toEqual({ role: "assistant", text: "**다 됐어요**" });
  });

  it("is gone when the turn is stopped before any reply", async () => {
    const turn = heldEvents();
    const { client } = fakeClient([turn.events]);
    const chat = open(client);
    act(() => {
      chat.result.current.send("찾아 줘");
    });
    await waitFor(() => {
      expect(chat.result.current.status.kind).toBe("streaming");
    });
    act(() => {
      turn.text("찾아볼게요");
      turn.mark();
    });
    await waitFor(() => {
      expect(replyOf(chat).interim).toBe("찾아볼게요");
    });
    act(() => {
      chat.result.current.stop();
    });
    await settled(chat);
    expect(replyOf(chat)).toMatchObject({ interim: null, ending: "stopped" });
  });
});

describe("proposals", () => {
  const withProposal = (committed?: Parameters<typeof fakeClient>[1]) =>
    fakeClient([[{ type: "proposal", proposal }]], committed);

  it("opens the last proposal not yet added once its reply ended, counting the cards checked", async () => {
    const { client } = withProposal();
    const chat = open(client);
    expect(chat.result.current.open).toBeUndefined();
    await say(chat, "카드 만들어 줘");
    expect(chat.result.current.open).toMatchObject({ count: 3 });
    act(() => {
      const { open: shown } = chat.result.current;
      chat.result.current.check(shown?.turnId ?? "", "p1", "g1", ["c1"]);
    });
    expect(chat.result.current.open?.count).toBe(2);
    act(() => {
      chat.result.current.check(replyOf(chat).id, "p1", "g2", []);
    });
    expect(chat.result.current.open?.count).toBe(1);
  });

  it("adds the cards checked, then records the note and the counts and opens no proposal", async () => {
    const { client, commits } = withProposal({
      kind: "added",
      deck: { id: "d1", name: "영단어" },
      count: 2,
      skipped: 1,
      refused: 3,
    });
    const chat = open(client);
    await say(chat, "카드 만들어 줘");
    act(() => {
      chat.result.current.check(replyOf(chat).id, "p1", "g1", ["c1"]);
      chat.result.current.check(replyOf(chat).id, "p1", "g2", []);
    });
    await act(async () => {
      await chat.result.current.commit();
    });
    expect(commits).toEqual([{ proposal: "p1", checked: { g1: ["c1"], g2: [] } }]);
    expect(replyOf(chat).proposals[0]?.added).toEqual({
      deck: { id: "d1", name: "영단어" },
      count: 2,
      skipped: 1,
      refused: 3,
    });
    expect(chat.result.current.open).toBeUndefined();
    expect(chat.result.current.committing).toBe(false);
  });

  it("keeps the proposal open and says why when the commit fails, and clears that on the next message", async () => {
    const { client } = withProposal({ kind: "failed", message: "카드를 추가하지 못했어요." });
    const chat = open(client);
    await say(chat, "카드 만들어 줘");
    await act(async () => {
      await chat.result.current.commit();
    });
    expect(chat.result.current.commitFailure).toBe("카드를 추가하지 못했어요.");
    expect(chat.result.current.open).toBeDefined();
    expect(replyOf(chat).proposals[0]?.added).toBeFalsy();
  });

  it("commits nothing with no card checked", async () => {
    const { client, commits } = withProposal();
    const chat = open(client);
    await say(chat, "카드 만들어 줘");
    act(() => {
      chat.result.current.check(replyOf(chat).id, "p1", "g1", []);
      chat.result.current.check(replyOf(chat).id, "p1", "g2", []);
    });
    await act(async () => {
      await chat.result.current.commit();
    });
    expect(commits).toEqual([]);
  });
});

describe("clearing", () => {
  it("forgets the turns, the draft, the status and a commit's failure, and the stored conversation", async () => {
    const { client } = fakeClient([{ kind: "unavailable" }]);
    const chat = open(client);
    await say(chat, "안녕");
    expect(chat.result.current.status.kind).toBe("refused");
    act(() => {
      chat.result.current.clear();
    });
    expect(chat.result.current.turns).toEqual([]);
    expect(chat.result.current.draft).toBe("");
    expect(chat.result.current.status).toEqual({ kind: "idle" });
    await waitFor(() => {
      expect(window.localStorage.getItem(storageKey)).toBeNull();
    });
  });
});

const progress = (
  finished: number,
  state: "running" | "done" | "cancelled" = "running",
): JobPoll => ({
  kind: "polled",
  progress: { id: "j1", photos: 3, finished, state },
});
const photoFile = (name: string) => new File([name], name, { type: "image/png" });

describe("photos", () => {
  it("stages the photos picked, takes one away, and shows the staged ones up to 50", async () => {
    const chat = open(fakeClient([]).client);
    await act(async () => {
      await chat.result.current.attach([photoFile("a.png"), photoFile("b.png")]);
    });
    expect(chat.result.current.staged).toHaveLength(2);
    expect(chat.result.current.staged.every((photo) => photo.jpeg.type === "image/jpeg")).toBe(
      true,
    );
    act(() => {
      chat.result.current.unstage(chat.result.current.staged[0] as never);
    });
    expect(chat.result.current.staged).toHaveLength(1);
    await act(async () => {
      await chat.result.current.attach(
        Array.from({ length: 60 }, (_, i) => photoFile(`${String(i)}.png`)),
      );
    });
    expect(chat.result.current.staged).toHaveLength(50);
  });

  it("uploads the staged photos under their ids and sends them with the message, emptying the staged", async () => {
    const { client, requests, uploads } = fakeClient([[{ type: "text", delta: "받았어요" }]]);
    const chat = open(client);
    await act(async () => {
      await chat.result.current.attach([photoFile("c.png"), photoFile("d.png")]);
    });
    const ids = chat.result.current.staged.map((photo) => photo.id);
    act(() => {
      chat.result.current.setDraft("읽어 줘");
    });
    await act(async () => {
      await chat.result.current.submit();
    });
    await settled(chat);
    expect(uploads[0]?.map((photo) => photo.id)).toEqual(ids);
    expect(requests[0]?.messages).toEqual([{ role: "user", text: "읽어 줘", photos: ids }]);
    expect(chat.result.current.staged).toEqual([]);
  });

  it("sends a photo alone as a message", async () => {
    const { client, requests } = fakeClient([[{ type: "text", delta: "받았어요" }]]);
    const chat = open(client);
    await act(async () => {
      await chat.result.current.attach([photoFile("a.png")]);
    });
    await act(async () => {
      await chat.result.current.submit();
    });
    await settled(chat);
    expect(requests[0]?.messages[0]).toMatchObject({ role: "user", text: "" });
  });

  it("sends nothing when a photo does not upload, keeping the photos and the words", async () => {
    const { client, requests } = fakeClient([], undefined, { stored: false });
    const chat = open(client);
    await act(async () => {
      await chat.result.current.attach([photoFile("a.png")]);
    });
    act(() => {
      chat.result.current.setDraft("읽어 줘");
    });
    await act(async () => {
      await chat.result.current.submit();
    });
    expect(chat.result.current.status.kind).toBe("uploadFailed");
    expect(requests).toEqual([]);
    expect(chat.result.current.staged).toHaveLength(1);
    expect(chat.result.current.draft).toBe("읽어 줘");
  });

  /** A reply that started a photo job, with its photo attached and sent. */
  async function startJob(
    replies: Parameters<typeof fakeClient>[0],
    photos: Parameters<typeof fakeClient>[2],
  ) {
    const fake = fakeClient(replies, undefined, photos);
    const chat = open(fake.client);
    await act(async () => {
      await chat.result.current.attach([photoFile("a.png")]);
    });
    await act(async () => {
      await chat.result.current.submit();
    });
    return { ...fake, chat };
  }

  it("asks after a running job every few seconds, and goes on by itself, undrawn, once it is read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { chat, requests, asked } = await startJob(
      [
        [
          { type: "text", delta: "사진을 읽고 있어요" },
          { type: "job", id: "j1", photos: 3 },
        ],
        [{ type: "text", delta: "카드로 만들게요" }],
      ],
      { polls: [progress(1), progress(3, "done")] },
    );
    await settled(chat);
    expect(replyOf(chat).job).toEqual({ id: "j1", photos: 3, finished: 0, state: "running" });
    expect(asked).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(jobPollMs);
    });
    expect(replyOf(chat).job?.finished).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(jobPollMs);
    });
    await settled(chat);
    expect(asked).toEqual(["j1", "j1"]);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.slice(-2)).toEqual([
      { role: "assistant", text: "사진을 읽고 있어요", job: { id: "j1", photos: 3 } },
      { role: "user", text: jobDoneMessage },
    ]);
    expect(
      chat.result.current.turns.find((turn) => turn.role === "user" && turn.auto),
    ).toBeDefined();
    // A done job is asked after no more.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(jobPollMs * 2);
    });
    expect(asked).toHaveLength(2);
  });

  it("tells a job done only once the reply that is still streaming has ended", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let end = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      end = resolve;
    });
    const { chat, requests } = await startJob(
      [
        () => ({
          kind: "stream",
          events: (async function* () {
            yield { type: "job", id: "j1", photos: 3 } as const;
            await gate;
            yield { type: "text", delta: "읽는 중이에요" } as const;
          })(),
        }),
        [{ type: "text", delta: "카드로 만들게요" }],
      ],
      { polls: [progress(3, "done"), progress(3, "done")] },
    );
    await waitFor(() => {
      expect(replyOf(chat).job).not.toBeNull();
    });
    // Asked while the reply streams: the answer waits, and nothing is sent.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(jobPollMs);
    });
    expect(replyOf(chat).job?.state).toBe("running");
    expect(requests).toHaveLength(1);
    end();
    await waitFor(() => {
      expect(replyOf(chat).text).toBe("읽는 중이에요");
    });
    await settled(chat);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(jobPollMs);
    });
    await settled(chat);
    expect(requests).toHaveLength(2);
    expect(replyOf(chat).text).toBe("카드로 만들게요");
  });

  it("cancels the job it reads and asks after it no more", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { chat, asked, cancels } = await startJob([[{ type: "job", id: "j1", photos: 3 }]], {});
    await settled(chat);
    await act(async () => {
      await chat.result.current.cancelJob();
    });
    expect(cancels).toEqual(["j1"]);
    expect(replyOf(chat).job?.state).toBe("cancelled");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(jobPollMs * 2);
    });
    expect(asked).toEqual([]);
  });

  it("keeps the job running when its cancel is refused, and takes a job the function lost as cancelled", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { chat } = await startJob([[{ type: "job", id: "j1", photos: 3 }]], {
      cancelled: false,
      polls: [{ kind: "missing" }],
    });
    await settled(chat);
    await act(async () => {
      await chat.result.current.cancelJob();
    });
    // Control: a refused cancel is not a cancelled job.
    expect(replyOf(chat).job?.state).toBe("running");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(jobPollMs);
    });
    expect(replyOf(chat).job?.state).toBe("cancelled");
  });

  it("asks after a stored running job when the chat opens", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const first = startJob([[{ type: "job", id: "j1", photos: 3 }]], {});
    const { chat } = await first;
    await settled(chat);
    chat.unmount();
    const { client, asked } = fakeClient([], undefined, { polls: [progress(2)] });
    const reopened = open(client);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(jobPollMs);
    });
    expect(asked).toEqual(["j1"]);
    expect(replyOf(reopened).job?.finished).toBe(2);
  });
});
