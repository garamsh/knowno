import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatBubble, type ChatLine } from "../components/ready-bubble";

const shownKey = "knowno.assistant.offer";
const words: Record<ChatLine, string> = {
  cards: "오늘 배운 거, 같이 카드로 만들까요?",
  done: "수고했어요. 얘기 좀 할래요?",
  other: "말랑이와 대화해요",
};

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

const draw = (line: ChatLine = "cards") => render(<ChatBubble line={line} className="bubble" />);
const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const bubble = () => screen.queryByText(/./);

const readyProposal = () => {
  window.localStorage.setItem(
    "knowno.assistant",
    JSON.stringify({
      version: 1,
      draft: "",
      turns: [
        {
          role: "assistant",
          id: "a1",
          text: "",
          citations: [],
          choice: null,
          ending: "ok",
          proposals: [
            {
              proposal: {
                id: "p1",
                kind: "cards",
                deck: { id: null, name: "영단어" },
                groups: [
                  {
                    id: "g1",
                    title: "1",
                    format: "text",
                    cards: [{ id: "c1", card: { front: "a", back: "b" } }],
                  },
                ],
              },
              checked: { g1: ["c1"] },
              added: null,
            },
          ],
        },
      ],
    }),
  );
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 11, 9, 0, 0));
  window.localStorage.clear();
  reduceMotion(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("the offer over 홈's mascot", () => {
  it("shows a moment after 홈 appears, and is gone after about 6 s", async () => {
    draw();
    expect(bubble()).toBeNull();
    await pass(1000);
    expect(bubble()).toBeNull();
    await pass(600);
    expect(bubble()).toHaveTextContent(words.cards);
    await pass(5000);
    expect(bubble()).toHaveTextContent(words.cards);
    await pass(1500);
    await pass(400);
    expect(bubble()).toBeNull();
  });

  it("says the line 홈's state gave, and is decoration the mascot's link does not repeat", async () => {
    for (const line of ["cards", "done", "other"] as const) {
      window.localStorage.clear();
      draw(line);
      await pass(1600);
      expect(bubble()).toHaveTextContent(words[line]);
      expect(bubble()).toHaveAttribute("aria-hidden", "true");
      cleanup();
    }
  });

  it("shows once a local day, on the first open of it, and again the next day", async () => {
    draw();
    await pass(1600);
    expect(bubble()).not.toBeNull();
    await pass(7000);
    await pass(500);
    expect(bubble()).toBeNull();
    cleanup();

    // A later open the same day shows nothing, even as the day nears its end.
    vi.setSystemTime(new Date(2026, 10, 11, 23, 59, 0));
    draw();
    await pass(2000);
    expect(bubble()).toBeNull();
    cleanup();

    // Control: the next local day shows it again.
    vi.setSystemTime(new Date(2026, 10, 12, 0, 1, 0));
    draw();
    await pass(1600);
    expect(bubble()).not.toBeNull();
  });

  it("spends the day only once it has shown: a 홈 left within the delay shows it later", async () => {
    draw();
    await pass(400);
    cleanup();
    expect(window.localStorage.getItem(shownKey)).toBeNull();
    draw();
    await pass(1600);
    expect(bubble()).not.toBeNull();
    expect(window.localStorage.getItem(shownKey)).toBe("2026-11-11");
  });

  it("waits while the ready bubble shows, and does not spend the day", async () => {
    readyProposal();
    draw();
    await pass(2000);
    expect(bubble()).toBeNull();
    expect(window.localStorage.getItem(shownKey)).toBeNull();
    // Control: once nothing is ready, the offer shows after the delay and spends the day.
    act(() => {
      window.localStorage.removeItem("knowno.assistant");
      window.dispatchEvent(new StorageEvent("storage", { key: "knowno.assistant" }));
    });
    await pass(1600);
    expect(bubble()).toHaveTextContent(words.cards);
    expect(window.localStorage.getItem(shownKey)).toBe("2026-11-11");
  });

  it("is never drawn once the ready bubble appears while it shows", async () => {
    draw();
    await pass(1600);
    expect(bubble()).not.toBeNull();
    act(() => {
      readyProposal();
      window.dispatchEvent(new StorageEvent("storage", { key: "knowno.assistant" }));
    });
    expect(bubble()).toBeNull();
  });

  it("draws no fade under reduced motion, and hides at once at the end", async () => {
    reduceMotion(true);
    draw();
    await pass(1600);
    const shown = bubble();
    expect(shown).not.toBeNull();
    expect(shown?.className).not.toContain("transition-opacity");
    await pass(6000);
    expect(bubble()).toBeNull();
  });

  it("fades before it goes when motion is allowed, against reduced motion's none", async () => {
    draw();
    await pass(1600);
    expect(bubble()?.className).toContain("transition-opacity");
    await pass(6000);
    expect(bubble()?.className).toContain("opacity-0");
    await pass(400);
    expect(bubble()).toBeNull();
  });

  it("still shows when the browser refuses storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    draw();
    await pass(1600);
    expect(bubble()).not.toBeNull();
    vi.restoreAllMocks();
  });
});
