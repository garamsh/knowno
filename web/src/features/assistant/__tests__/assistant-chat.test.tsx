import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantClient, SendResult } from "../assistant-client";
import { AssistantChat } from "../components/assistant-chat";
import { busyRetryMs } from "../use-assistant-chat";
import type { AssistantEvent, Proposal } from "../protocol";
import { fakeClient, proposal, stream, usage } from "./fake-client";

// jsdom decodes no image: the preparation is design/'s own, and here gives a fixed JPEG.
vi.mock("@/design/prepare-photo", () => ({
  downscalePhoto: vi.fn((file: Blob) =>
    Promise.resolve(new File([file], "photo.jpg", { type: "image/jpeg" })),
  ),
}));

const allowance = { tokenBudget: 200000, tokensUsed: 20000 };

async function say(text: string) {
  const field = screen.getByRole("textbox", { name: "말랑이에게 보낼 메시지" });
  await userEvent.type(field, text);
  await userEvent.click(screen.getByRole("button", { name: "보내기" }));
}

/** The zone the browser names in every test but the ones that say another. */
const browserZone = "America/New_York";

beforeEach(() => {
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    timeZone: browserZone,
  } as Intl.ResolvedDateTimeFormatOptions);
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: () => "blob:photo", revokeObjectURL: () => undefined }),
  );
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("말랑이's chat", () => {
  it("draws 말랑이's reply as Markdown and the user's own turn as typed", async () => {
    const { client } = fakeClient([[{ type: "text", delta: "**굵게** 말해요\n\n- 하나" }]]);
    render(<AssistantChat allowance={null} client={client} />);
    await say("**내 말** 그대로");
    expect(await screen.findByText("굵게")).toBeInTheDocument();
    expect(screen.getByText("굵게").tagName).toBe("STRONG");
    expect(screen.getByText("하나").tagName).toBe("LI");
    // The user's turn keeps its marks, and is no element of Markdown.
    expect(screen.getByText("**내 말** 그대로")).toBeInTheDocument();
    expect(screen.queryByText("내 말")).not.toBeInTheDocument();
  });

  it("sends a choice's pick as the next message, after the question it answers", async () => {
    const { client } = fakeClient([
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
    // The question is answered: its options are gone.
    expect(screen.queryByRole("group", { name: "형식" })).not.toBeInTheDocument();
  });

  it("adds the cards checked, by card and by group, and then shows the note it wrote, which opens it", async () => {
    const { client } = fakeClient([[{ type: "proposal", proposal }]]);
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
    const shortcut = await screen.findByRole("link", { name: /영단어/ });
    expect(shortcut).toHaveAttribute("href", "/decks/d1");
    // A substring: the link reads the note's name, then its count.
    expect(shortcut).toHaveAccessibleName(/영단어.*카드 2장/);
    expect(screen.queryByRole("button", { name: /장 추가$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("draws a proposed 글 and a cloze of version 2 as the card reads, never as their markup", async () => {
    const markup: Proposal = {
      ...proposal,
      groups: [
        {
          id: "g1",
          title: "1단원",
          format: "mixed",
          cards: [
            { id: "c1", card: { blocks: [{ type: "text", front: "**apple**", back: "- 사과" }] } },
            {
              id: "c2",
              card: { blocks: [{ type: "cloze", text: "{{c1::Paris::city}} is {{c2::big}}" }] },
            },
          ],
        },
      ],
    };
    const { client } = fakeClient([[{ type: "proposal", proposal: markup }]]);
    render(<AssistantChat allowance={null} client={client} />);
    await say("카드 만들어 줘");

    expect(await screen.findByRole("checkbox", { name: /apple/ })).toHaveAccessibleName(
      "apple사과",
    );
    expect(screen.getByRole("checkbox", { name: /___\(city\)/ })).toHaveAccessibleName(
      "___(city) is ___Paris, big",
    );
    expect(document.body).not.toHaveTextContent("{{");
    expect(document.body).not.toHaveTextContent("**");
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

  it("says a message refused as busy waits, until it goes again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { client } = fakeClient([{ kind: "busy" }, [{ type: "text", delta: "왔어요" }]]);
    render(<AssistantChat allowance={null} client={client} />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await user.type(screen.getByRole("textbox", { name: "말랑이에게 보낼 메시지" }), "안녕");
    await user.click(screen.getByRole("button", { name: "보내기" }));
    expect(
      await screen.findByText("앞의 메시지를 마무리하고 있어요. 잠시 후 다시 보낼게요."),
    ).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(busyRetryMs);
    });
    expect(await screen.findByText("왔어요")).toBeInTheDocument();
    expect(
      screen.queryByText("앞의 메시지를 마무리하고 있어요. 잠시 후 다시 보낼게요."),
    ).not.toBeInTheDocument();
  });

  it("offers 다시 시도 after a failed reply, which sends the message again in the reply's place", async () => {
    const { client } = fakeClient([
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
    expect(
      screen.queryByText("말랑이가 답하지 못했어요. 다시 시도해 주세요."),
    ).not.toBeInTheDocument();
  });

  it("says a turn stopped at its limit with nothing to show, and tries again, against a limit turn with a reply", async () => {
    const limitNotice = "할 일이 많아 여기서 멈췄어요. 다시 시도해 주세요.";
    const { client } = fakeClient([
      [{ type: "interim" }, usage(1000, true)],
      [{ type: "text", delta: "이번엔 됐어요" }],
      [{ type: "text", delta: "여기까지 찾았어요" }, usage(2000, true)],
    ]);
    render(<AssistantChat allowance={null} client={client} />);
    await say("안녕");
    expect(await screen.findByText(limitNotice)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("이번엔 됐어요")).toBeInTheDocument();
    expect(screen.queryByText(limitNotice)).not.toBeInTheDocument();
    // Control: a limit turn with a reply shows the reply alone.
    await say("또");
    expect(await screen.findByText("여기까지 찾았어요")).toBeInTheDocument();
    expect(screen.queryByText(limitNotice)).not.toBeInTheDocument();
  });

  it("says how many cards a commit left out beside the count, and nothing for a commit that wrote all", async () => {
    const left = {
      kind: "added",
      deck: { id: "d1", name: "영단어" },
      count: 2,
      skipped: 1,
      refused: 3,
    } as const;
    const first = fakeClient([[{ type: "proposal", proposal }]], left);
    const { unmount } = render(<AssistantChat allowance={null} client={first.client} />);
    await say("만들어 줘");
    await userEvent.click(await screen.findByRole("button", { name: "3장 추가" }));
    const shortcut = await screen.findByRole("link", { name: /영단어/ });
    expect(shortcut).toHaveTextContent(
      "카드 2장 · 1장은 이미 노트에 있어요 · 3장은 추가하지 못했어요",
    );
    unmount();
    window.localStorage.clear();
    // Control: a commit that wrote every card says only the count.
    const whole = fakeClient([[{ type: "proposal", proposal }]]);
    render(<AssistantChat allowance={null} client={whole.client} />);
    await say("만들어 줘");
    await userEvent.click(await screen.findByRole("button", { name: "3장 추가" }));
    const plain = await screen.findByRole("link", { name: /영단어/ });
    expect(plain).toHaveTextContent(/^영단어카드 2장$/);
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

  describe("interim remarks as a passing status line", () => {
    /** A reply whose events the test lets through one at a time; `end` closes the stream. */
    function held() {
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

    // The interim lines: the typing dots' own status, named for a screen reader, is not one.
    const lines = () =>
      screen
        .queryAllByRole("status")
        .filter((element) => element.textContent !== "말랑이가 생각하는 중이에요");
    const line = () => lines()[0] ?? screen.getByRole("status");

    it("shows one line a call in a polite region, then only the reply", async () => {
      const turn = held();
      const { client } = fakeClient([turn.events]);
      render(<AssistantChat allowance={null} client={client} />);
      await say("카드 만들어 줘");
      expect(await screen.findByText("말랑이가 생각하는 중이에요")).toBeInTheDocument();

      // The first call's text streams in as the reply until its mark arrives (ADR 0224).
      turn.text("**노트**를\n찾아볼게요");
      expect(await screen.findByText("찾아볼게요", { exact: false })).toBeInTheDocument();
      turn.mark();
      await waitFor(() => {
        expect(line()).toHaveTextContent(/^노트를 찾아볼게요$/);
      });
      const live = line();
      expect(live).toHaveAttribute("aria-live", "polite");
      expect(live.textContent).not.toContain("*");
      expect(lines()).toHaveLength(1);
      // The dots stay under the line, until the reply's first text.
      expect(screen.getByText("말랑이가 생각하는 중이에요")).toBeInTheDocument();

      // The second call's text is the reply for a moment, then a line in the first one's place.
      turn.text("\n\n");
      turn.text("[카드](https://example.com)를 만들게요");
      turn.mark();
      await waitFor(() => {
        expect(line()).toHaveTextContent(/^카드를 만들게요$/);
      });
      expect(lines()).toHaveLength(1);
      expect(line()).toBe(live);
      expect(screen.queryByRole("link", { name: "카드" })).not.toBeInTheDocument();

      // The reply starts: the line goes, and the reply has no leading separator.
      turn.text("\n\n");
      turn.text("**다 됐어요**");
      expect(await screen.findByText("다 됐어요")).toBeInTheDocument();
      expect(lines()).toHaveLength(0);
      expect(screen.queryByText("말랑이가 생각하는 중이에요")).not.toBeInTheDocument();
      turn.end();
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "보내기" })).toBeInTheDocument();
      });
      expect(lines()).toHaveLength(0);
      expect(screen.queryByText(/찾아볼게요|만들게요/)).not.toBeInTheDocument();
    });

    it("leaves a turn of one call as it was: no line, the reply as it streams", async () => {
      const turn = held();
      const { client } = fakeClient([turn.events]);
      render(<AssistantChat allowance={null} client={client} />);
      await say("안녕");
      expect(await screen.findByRole("status")).toHaveTextContent("말랑이가 생각하는 중이에요");
      turn.text("안녕");
      turn.text("하세요");
      expect(await screen.findByText("안녕하세요")).toBeInTheDocument();
      expect(lines()).toHaveLength(0);
      turn.end();
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "보내기" })).toBeInTheDocument();
      });
      expect(screen.getByText("안녕하세요")).toBeInTheDocument();
      expect(lines()).toHaveLength(0);
    });
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
  });
});

const photoFile = (name: string) => new File([name], name, { type: "image/png" });

describe("photos in the chat", () => {
  const attach = async (...names: string[]) => {
    await userEvent.upload(screen.getByLabelText("사진 첨부"), names.map(photoFile));
  };
  const storedJob = (state: "running" | "done" | "cancelled", finished: number) => {
    window.localStorage.setItem(
      "knowno.assistant",
      JSON.stringify({
        version: 1,
        draft: "",
        turns: [
          { role: "user", id: "u", text: "읽어 줘", photos: ["a"], auto: false },
          {
            role: "assistant",
            id: "r",
            text: "읽고 있어요",
            citations: [],
            proposals: [],
            choice: null,
            job: { id: "j1", photos: 3, finished, state },
            interim: null,
            ending: "ok",
          },
        ],
      }),
    );
  };

  it("draws the photos staged as thumbnails to take away, and a photo alone as enough to send", async () => {
    render(<AssistantChat allowance={null} client={fakeClient([]).client} />);
    await attach("a.png", "b.png");
    expect(await screen.findByRole("list", { name: "사진 2장" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "보내기" })).toBeEnabled();
    await userEvent.click(screen.getAllByRole("button", { name: "사진 삭제" })[0] as HTMLElement);
    expect(screen.getByRole("list", { name: "사진 1장" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "사진 삭제" }));
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
  });

  it("shows the message's photos as a count, and the staged ones gone, once sent", async () => {
    const { client } = fakeClient([[{ type: "text", delta: "받았어요" }]]);
    render(<AssistantChat allowance={null} client={client} />);
    await attach("c.png", "d.png");
    await screen.findByRole("list", { name: "사진 2장" });
    await userEvent.type(
      screen.getByRole("textbox", { name: "말랑이에게 보낼 메시지" }),
      "읽어 줘",
    );
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(await screen.findByText("받았어요")).toBeInTheDocument();
    expect(screen.getByText("사진 2장")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /^사진/ })).not.toBeInTheDocument();
  });

  it("says a photo that does not upload did not, keeping the photos and the words", async () => {
    const { client } = fakeClient([], undefined, { stored: false });
    render(<AssistantChat allowance={null} client={client} />);
    await attach("a.png");
    await userEvent.type(
      screen.getByRole("textbox", { name: "말랑이에게 보낼 메시지" }),
      "읽어 줘",
    );
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(
      await screen.findByText("사진을 올리지 못했어요. 다시 시도해 주세요."),
    ).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "사진 1장" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "말랑이에게 보낼 메시지" })).toHaveValue("읽어 줘");
  });

  it("draws a running job's progress with its cancel, and a job done or cancelled as said", async () => {
    storedJob("running", 1);
    const { client, cancels } = fakeClient([]);
    const { unmount } = render(<AssistantChat allowance={null} client={client} />);
    expect(await screen.findByText("1/3장 읽는 중")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "사진 읽기" })).toHaveAttribute("value", "1");
    await userEvent.click(screen.getByRole("button", { name: "읽기 취소" }));
    expect(cancels).toEqual(["j1"]);
    expect(await screen.findByText("사진 읽기를 취소했어요")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "읽기 취소" })).not.toBeInTheDocument();
    unmount();

    storedJob("done", 3);
    render(<AssistantChat allowance={null} client={fakeClient([]).client} />);
    expect(await screen.findByText("사진 3장을 다 읽었어요")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "읽기 취소" })).not.toBeInTheDocument();
  });
});

describe("the chat drawn as a messenger (ADR 0250)", () => {
  const stored = (...turns: object[]) => {
    window.localStorage.setItem(
      "knowno.assistant",
      JSON.stringify({ version: 1, draft: "", turns }),
    );
  };
  const user = (id: string) => ({ role: "user", id, text: `질문 ${id}`, photos: [], auto: false });
  const reply = (id: string, text: string, ending: string | null = "ok") => ({
    role: "assistant",
    id,
    text,
    citations: [],
    proposals: [],
    choice: null,
    job: null,
    interim: null,
    ending,
  });
  /** The profiles beside the turns, each the mascot's still image, by its face. */
  const profiles = (container: HTMLElement, face: string) =>
    container.querySelectorAll(`ol[aria-label="대화"] img[src*="knowno-${face}"]`);
  const names = () => within(screen.getByRole("list", { name: "대화" })).queryAllByText("말랑이");

  /** A send whose headers are held back until [release], as the route's are while the function starts. */
  function held() {
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
  const dots = () => document.querySelectorAll("[data-typing-dot]");

  /** Whether the browser asks for reduced motion. */
  function reduceMotion(reduce: boolean) {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: reduce && query.includes("prefers-reduced-motion"),
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
  }

  it("draws the profile and the name on the first bubble of a run alone, the user's bubble unchanged", () => {
    stored(user("a"), reply("r1", "하나"), reply("r2", "둘"), user("b"), reply("r3", "셋"));
    const { container } = render(<AssistantChat allowance={null} client={fakeClient([]).client} />);
    expect(screen.getByText("둘")).toBeInTheDocument();
    // Two runs, two names and two profiles: the third bubble of three starts none.
    expect(names()).toHaveLength(2);
    expect(container.querySelectorAll('ol[aria-label="대화"] img')).toHaveLength(2);
    // The user's bubble has neither.
    expect(screen.getByText("질문 a")).toBeInTheDocument();
  });

  it("gives the last run's profile the state's face and an earlier run's thinking", () => {
    stored(user("a"), reply("r1", "하나"), user("b"), reply("r2", "", "model_error"));
    const { container } = render(<AssistantChat allowance={null} client={fakeClient([]).client} />);
    expect(profiles(container, "sad")).toHaveLength(1);
    expect(profiles(container, "thinking")).toHaveLength(1);
  });

  it("draws a mascot in no part of the bar", () => {
    stored(user("a"), reply("r1", "하나"));
    render(<AssistantChat allowance={allowance} client={fakeClient([]).client} />);
    const bar = screen.getByRole("banner");
    expect(within(bar).getByRole("heading", { name: "말랑이" })).toBeInTheDocument();
    expect(bar.querySelector("img")).toBeNull();
  });

  it("draws the empty chat as a large profile with the name and what to memorise", async () => {
    const { container } = render(<AssistantChat allowance={null} client={fakeClient([]).client} />);
    expect(await screen.findByText("무엇을 외워 볼까요?")).toBeInTheDocument();
    expect(names()).toHaveLength(1);
    expect(profiles(container, "thinking")).toHaveLength(1);
    expect(container.querySelector("ol[aria-label='대화'] .size-24")).not.toBeNull();
    // The bar's title is the one heading.
    expect(screen.getAllByRole("heading", { name: "말랑이" })).toHaveLength(1);
  });

  it("shows the dots and a profile from the send, while the route's headers are pending, and not the old line", async () => {
    const { client, release } = held();
    const { container } = render(<AssistantChat allowance={null} client={client} />);
    await say("안녕");
    // No reply turn exists yet; the sign is drawn from the status and the user's turn.
    expect(dots()).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("말랑이가 생각하는 중이에요");
    expect(profiles(container, "thinking")).toHaveLength(1);
    expect(names()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "멈추기" })).toBeInTheDocument();

    // The first text ends the dots; the reply's turn carries its own profile.
    release(stream([{ type: "text", delta: "네" }], new AbortController().signal));
    expect(await screen.findByText("네")).toBeInTheDocument();
    expect(dots()).toHaveLength(0);
    expect(profiles(container, "thinking")).toHaveLength(1);
    expect(names()).toHaveLength(1);
  });

  it("takes the dots away on a refusal, beside a profile with the sad face, against the dots while waiting", async () => {
    const { client, release } = held();
    const { container } = render(<AssistantChat allowance={null} client={client} />);
    await say("안녕");
    expect(dots()).toHaveLength(3);
    release({ kind: "refused", refusal: { kind: "unavailable" } });
    expect(
      await screen.findByText("말랑이가 지금 답할 수 없어요. 잠시 후 다시 시도해 주세요."),
    ).toBeInTheDocument();
    expect(dots()).toHaveLength(0);
    expect(profiles(container, "sad")).toHaveLength(1);
    expect(names()).toHaveLength(1);
  });

  it("lets the dots rise when motion is allowed and stand still under reduced motion", async () => {
    for (const reduce of [false, true]) {
      reduceMotion(reduce);
      window.localStorage.clear();
      const { client } = held();
      const { unmount } = render(<AssistantChat allowance={null} client={client} />);
      await say("안녕");
      expect(dots()).toHaveLength(3);
      for (const dot of dots()) expect(dot.classList.contains("animate-typing-dot")).toBe(!reduce);
      unmount();
    }
  });
});
