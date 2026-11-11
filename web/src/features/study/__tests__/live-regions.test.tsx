import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CardId, DeckId } from "@/features/decks";

import { StudyScreen } from "../components/study-screen";
import { loadEngine } from "../engine";
import type { SessionPlan, StudyCard } from "../session";
import { unknownPace } from "../study-time";
import { textContent } from "@/testing/content";

const start = Date.UTC(2026, 0, 15, 9);
const card = (front: string): StudyCard => ({
  id: front as CardId,
  deckId: "d1" as DeckId,
  front: [textContent(front)],
  back: [textContent(`${front} back`)],
  createdAt: start,
  text: { front, back: `${front} back` },
  frontLength: front.length,
});

/** A plan over two new cards, going on with a day that has [done] answered "안다" when resumed. */
function plan(resumed: boolean): SessionPlan {
  return {
    startedAt: start,
    day: { start: start - 43_200_000, end: start + 43_200_000 },
    queue: { cards: [card("a"), card("b")], backlog: false },
    relearn: [],
    resumed,
    earlier: null,
    more: [],
    extra: [],
    before: {},
    pace: unknownPace,
    today: {
      answers: resumed
        ? [{ cardId: "done" as CardId, answer: "know", reviewedAt: start - 1000, durationMs: 0 }]
        : [],
      answeredAnyDeck: resumed,
      streakBefore: 0,
    },
  };
}

beforeAll(loadEngine);

describe("the study screen's live regions", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mounts the notice's status region empty, then says the day goes on, and empties it after 3 s", () => {
    window.localStorage.setItem("studyCoachShown", "true");
    render(<StudyScreen plan={plan(true)} loading={null} />);

    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(status).toHaveTextContent(/^이어서 해요 · 남은 2장 · 약 \d+분$/);
    act(() => {
      vi.advanceTimersByTime(2_999);
    });
    expect(status).not.toBeEmptyDOMElement();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(status).toBeEmptyDOMElement();
  });

  it("says nothing on the day's first session", () => {
    window.localStorage.setItem("studyCoachShown", "true");
    render(<StudyScreen plan={plan(false)} loading={null} />);
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("mounts the coach's live region empty, then announces its step as it starts and changes", () => {
    window.localStorage.removeItem("studyCoachShown");
    const { container } = render(<StudyScreen plan={plan(false)} loading={null} />);

    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toBeEmptyDOMElement();
    expect(screen.queryByRole("region", { name: "학습 사용 방법" })).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(live).toHaveTextContent("사용 방법, 3단계 중 1단계. 알면 안다(→)를 눌러요");
    expect(screen.getByRole("region", { name: "학습 사용 방법" })).toBeInTheDocument();
    act(() => {
      screen.getByRole("button", { name: "다음" }).click();
    });
    expect(live).toHaveTextContent("사용 방법, 3단계 중 2단계. 모르면 모른다(←)를 눌러요");
  });
});
