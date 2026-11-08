import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantClient, MessageRequest, SendResult } from "../assistant-client";
import type { CommitResult } from "../commit-proposal";
import { AssistantChat, busyRetryMs } from "../components/assistant-chat";
import type { AssistantEvent, Proposal, SendRefusal } from "../protocol";

const proposal: Proposal = {
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

const usage = (tokensUsed: number): AssistantEvent => ({
  type: "usage",
  allowance: { tokenBudget: 200000, tokensUsed },
});

/** A reply's events, each held until [gate] lets it through; an abort ends them with an AbortError. */
function stream(events: AssistantEvent[], signal: AbortSignal, gate?: Promise<void>): SendResult {
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
function fakeClient(
  replies: (AssistantEvent[] | SendRefusal | ((signal: AbortSignal) => SendResult))[],
  committed: CommitResult = { kind: "added", deck: { id: "d1", name: "영단어" }, count: 2 },
) {
  const requests: MessageRequest[] = [];
  const commits: unknown[] = [];
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
  };
  return { client, requests, commits };
}

const allowance = { tokenBudget: 200000, tokensUsed: 20000 };

async function say(text: string) {
  const field = screen.getByRole("textbox", { name: "말랑이에게 보낼 메시지" });
  await userEvent.type(field, text);
  await userEvent.click(screen.getByRole("button", { name: "보내기" }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("말랑이's chat", () => {
  it("streams the reply in as it arrives, and keeps the conversation and the draft in this browser", async () => {
    let open = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const first: AssistantEvent[] = [{ type: "text", delta: "좋아요, " }];
    const { client, requests } = fakeClient([
      (signal) => {
        const events = stream(first, signal);
        if (events.kind !== "stream") return events;
        return {
          kind: "stream",
          events: (async function* () {
            yield* events.events;
            await gate;
            yield { type: "text", delta: "만들어 볼게요" } as const;
            yield usage(72000);
          })(),
        };
      },
    ]);
    render(<AssistantChat allowance={allowance} client={client} />);
    expect(await screen.findByText("무엇을 외워 볼까요?")).toBeInTheDocument();
    expect(screen.getByText("오늘 90% 남았어요")).toBeInTheDocument();

    await say("영단어 카드 만들어 줘");
    expect(await screen.findByText("좋아요,")).toBeInTheDocument();
    // While it streams, the field cannot send, and the reply can be stopped.
    expect(screen.getByRole("button", { name: "멈추기" })).toBeInTheDocument();
    open();
    expect(await screen.findByText("좋아요, 만들어 볼게요")).toBeInTheDocument();
    expect(screen.getByText("오늘 64% 남았어요")).toBeInTheDocument();
    expect(requests).toEqual([{ messages: [{ role: "user", text: "영단어 카드 만들어 줘" }] }]);

    await userEvent.type(screen.getByRole("textbox", { name: "말랑이에게 보낼 메시지" }), "다음엔");
    cleanup();
    // Back from a note: the same turns and the draft, with nothing sent.
    render(<AssistantChat allowance={allowance} client={client} />);
    expect(await screen.findByText("영단어 카드 만들어 줘")).toBeInTheDocument();
    expect(screen.getByText("좋아요, 만들어 볼게요")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "말랑이에게 보낼 메시지" })).toHaveValue("다음엔");
    expect(requests).toHaveLength(1);
  });

  it("sends a choice's pick as the next message, after the question it answers", async () => {
    const { client, requests } = fakeClient([
      [
        { type: "text", delta: "어떤 형식으로 만들까요?" },
        { type: "choice", choice: { prompt: "형식", options: ["단어", "표", "알아서 섞어서"] } },
      ],
      [{ type: "text", delta: "단어로 만들게요" }],
    ]);
    render(<AssistantChat allowance={null} client={client} />);
    await say("이 단원 카드로");
    const options = await screen.findByRole("group", { name: "형식" });
    await userEvent.click(within(options).getByRole("button", { name: "단어" }));

    expect(await screen.findByText("단어로 만들게요")).toBeInTheDocument();
    expect(requests[1]?.messages.slice(-2)).toEqual([
      {
        role: "assistant",
        text: "어떤 형식으로 만들까요?",
        choice: { prompt: "형식", options: ["단어", "표", "알아서 섞어서"] },
      },
      { role: "user", text: "단어" },
    ]);
    // The question is answered: its options are gone.
    expect(screen.queryByRole("group", { name: "형식" })).not.toBeInTheDocument();
  });

  it("adds the cards checked, by card and by group, and then shows the note it wrote, which opens it", async () => {
    const { client, commits } = fakeClient([[{ type: "proposal", proposal }]]);
    render(<AssistantChat allowance={null} client={client} />);
    await say("카드 만들어 줘");

    const add = await screen.findByRole("button", { name: "3장 추가" });
    expect(screen.getByText("새 노트 · 영단어")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /pear/ }));
    expect(add).toHaveAccessibleName("2장 추가");
    const second = screen.getByRole("checkbox", { name: "2단원 모두 선택" });
    await userEvent.click(second);
    expect(add).toHaveAccessibleName("1장 추가");
    // A group partly checked is neither checked nor unchecked.
    expect(screen.getByRole("checkbox", { name: "1단원 모두 선택" })).toHaveProperty(
      "indeterminate",
      true,
    );

    await userEvent.click(add);
    expect(commits).toEqual([{ proposal: "p1", checked: { g1: ["c1"], g2: [] } }]);
    const shortcut = await screen.findByRole("link", { name: /영단어/ });
    expect(shortcut).toHaveAttribute("href", "/decks/d1");
    // A substring: the link reads the note's name, then its count.
    expect(shortcut).toHaveAccessibleName(/영단어.*카드 2장/);
    expect(screen.queryByRole("button", { name: /장 추가$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("says why a commit failed and keeps the proposal to add again", async () => {
    const { client } = fakeClient([[{ type: "proposal", proposal }]], {
      kind: "failed",
      message: "카드를 추가하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
    render(<AssistantChat allowance={null} client={client} />);
    await say("카드 만들어 줘");
    await userEvent.click(await screen.findByRole("button", { name: "3장 추가" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "카드를 추가하지 못했어요. 잠시 후 다시 시도해 주세요.",
    );
    expect(screen.getByRole("button", { name: "3장 추가" })).toBeEnabled();
  });

  it("asks 말랑이 to remake a group in another form", async () => {
    const { client, requests } = fakeClient([
      [{ type: "proposal", proposal }],
      [{ type: "text", delta: "바꿨어요" }],
    ]);
    render(<AssistantChat allowance={null} client={client} />);
    await say("카드 만들어 줘");
    const group = await screen.findByRole("region", { name: "1단원" });
    await userEvent.click(within(group).getByRole("button", { name: "다른 형식으로" }));
    // Every form but its own and a photo's.
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.textContent)
        .slice(1),
    ).toEqual(["글", "빈칸 문장", "표", "섞어서"]);
    await userEvent.click(within(group).getByRole("button", { name: "표" }));
    expect(await screen.findByText("바꿨어요")).toBeInTheDocument();
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "user",
      text: "1단원 부분은 표 형식으로 다시 만들어 줘",
    });
  });

  it("collapses a group of six or more cards to its count and form until it is opened", async () => {
    const big: Proposal = {
      ...proposal,
      groups: [
        {
          id: "g1",
          title: "전부",
          format: "senses",
          cards: Array.from({ length: 6 }, (_, index) => ({
            id: `c${String(index)}`,
            card: { front: `word${String(index)}`, back: "뜻" },
          })),
        },
      ],
    };
    const { client } = fakeClient([[{ type: "proposal", proposal: big }]]);
    render(<AssistantChat allowance={null} client={client} />);
    await say("카드 만들어 줘");
    await userEvent.click(await screen.findByRole("button", { name: "카드 6장 · 단어" }));
    expect(screen.getAllByRole("checkbox", { name: /word/ })).toHaveLength(6);
  });

  it("says the day's budget is used, with the sleepy mascot and no message field", async () => {
    const { client } = fakeClient([
      { kind: "rate_limited", allowance: { tokenBudget: 200000, tokensUsed: 200400 } },
    ]);
    const { container } = render(<AssistantChat allowance={allowance} client={client} />);
    await say("하나 더");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "오늘 말랑이와 이야기할 수 있는 만큼 다 썼어요. 내일 다시 이야기해요.",
    );
    expect(screen.getByText("오늘 0% 남았어요")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(container.querySelector('img[src*="knowno-sleepy"]')).not.toBeNull();
  });

  it("sends a message refused as busy again a few seconds later, while the one before it ends", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { client, requests } = fakeClient([
      { kind: "busy" },
      [{ type: "text", delta: "왔어요" }],
    ]);
    render(<AssistantChat allowance={null} client={client} />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await user.type(screen.getByRole("textbox", { name: "말랑이에게 보낼 메시지" }), "안녕");
    await user.click(screen.getByRole("button", { name: "보내기" }));
    expect(
      await screen.findByText("앞의 메시지를 마무리하고 있어요. 잠시 후 다시 보낼게요."),
    ).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(busyRetryMs);
    });
    expect(await screen.findByText("왔어요")).toBeInTheDocument();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  });

  it("offers 다시 시도 after a failed reply, which sends the message again in the reply's place", async () => {
    const { client, requests } = fakeClient([
      [{ type: "error", error: "model_error" }],
      [{ type: "text", delta: "이번엔 됐어요" }],
    ]);
    const { container } = render(<AssistantChat allowance={null} client={client} />);
    await say("안녕");
    expect(
      await screen.findByText("말랑이가 답하지 못했어요. 다시 시도해 주세요."),
    ).toBeInTheDocument();
    expect(container.querySelector('img[src*="knowno-sad"]')).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("이번엔 됐어요")).toBeInTheDocument();
    expect(requests[1]).toEqual({ messages: [{ role: "user", text: "안녕" }] });
    expect(
      screen.queryByText("말랑이가 답하지 못했어요. 다시 시도해 주세요."),
    ).not.toBeInTheDocument();
  });

  it("stops a streaming reply on 멈추기, saying so under what came", async () => {
    const { client } = fakeClient([
      (signal) => stream([{ type: "text", delta: "길게 쓰는 중" }], signal, Promise.resolve()),
    ]);
    render(<AssistantChat allowance={null} client={client} />);
    await say("길게");
    expect(await screen.findByText("길게 쓰는 중")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "멈추기" }));
    expect(await screen.findByText("멈췄어요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "보내기" })).toBeInTheDocument();
  });

  it("clears the conversation only through its confirmation, from ⋯", async () => {
    const { client } = fakeClient([[{ type: "text", delta: "네" }]]);
    render(<AssistantChat allowance={null} client={client} />);
    await say("안녕");
    await screen.findByText("네");
    await userEvent.click(screen.getByRole("button", { name: "대화 메뉴" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "대화 지우기" }));
    const dialog = screen.getByRole("dialog", { name: "대화를 지울까요?" });
    // Control: the cancel keeps it.
    await userEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(screen.getByText("안녕")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "대화 메뉴" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "대화 지우기" }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "대화를 지울까요?" })).getByRole("button", {
        name: "지우기",
      }),
    );
    expect(await screen.findByText("무엇을 외워 볼까요?")).toBeInTheDocument();
    expect(screen.queryByText("안녕")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(window.localStorage.getItem("knowno.assistant")).toBeNull();
    });
  });
});
