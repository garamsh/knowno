import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CardId, DeckId } from "@/features/decks";

import { StudyScreen } from "../components/study-screen";
import type { SessionPlan, StudyCard } from "../session";
import { unknownPace } from "../study-time";

// The engine's first load fails, as a dropped connection would fail its fetch; a retry loads it.
const failures = vi.hoisted(() => ({ left: 1 }));
vi.mock("../engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../engine")>();
  return {
    ...actual,
    engineLoaded: () => false,
    loadEngine: () => {
      if (failures.left > 0) {
        failures.left -= 1;
        return Promise.reject(new Error("the module could not be fetched"));
      }
      return actual.loadEngine();
    },
  };
});

const start = Date.UTC(2026, 0, 15, 9);
const card: StudyCard = {
  id: "a" as CardId,
  deckId: "d1" as DeckId,
  front: [{ kind: "text", text: "a" }],
  back: [{ kind: "text", text: "a back" }],
  createdAt: start,
  text: { front: "a", back: "a back" },
  frontLength: 1,
};
const plan: SessionPlan = {
  startedAt: start,
  day: { start: start - 43_200_000, end: start + 43_200_000 },
  queue: { cards: [card], backlog: false },
  relearn: [],
  resumed: false,
  earlier: null,
  more: [],
  extra: [],
  before: {},
  pace: unknownPace,
  today: { answers: [], answeredAnyDeck: false, streakBefore: 0 },
};

describe("the study screen's engine", () => {
  it("says it could not load the study screen, offers 그만하기 back to 오늘, and 다시 시도 loads it and starts the session", async () => {
    render(<StudyScreen plan={plan} loading={<p>불러오는 중</p>} />);

    expect(
      await screen.findByText("학습 화면을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "앞면" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "그만하기" })).toHaveAttribute("href", "/");

    await userEvent.setup().click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByRole("group", { name: "앞면" })).toHaveTextContent("a");
  });
});
