import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CardId, DeckId } from "@/features/decks";
import { day, start, uuidOf } from "@/testing/library";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { signedInCookies } from "@/testing/session";

import { StudyScreen } from "../components/study-screen";
import { loadEngine } from "../engine";
import { type SessionPlan, type StudyCard, StudySession } from "../session";
import { unknownPace } from "../study-time";

vi.mock("next/headers", () => import("@/testing/next-headers"));

const card = (front: string): StudyCard => ({
  id: uuidOf(front) as CardId,
  deckId: "d1" as DeckId,
  front: [{ kind: "text", text: front }],
  back: [{ kind: "text", text: `${front} back` }],
  createdAt: start - day,
  text: { front, back: `${front} back` },
  frontLength: front.length,
});

/** A session over two new cards, opened at [start]. */
const plan: SessionPlan = {
  startedAt: start,
  day: { start: start - day / 2, end: start + day / 2 },
  queue: { cards: [card("a"), card("b")], backlog: false },
  relearn: [],
  resumed: false,
  earlier: null,
  more: [],
  extra: [],
  before: {},
  pace: unknownPace,
  today: {
    answers: [],
    answeredAnyDeck: false,
    streakBefore: 0,
  },
};

beforeAll(loadEngine);

describe("an answer's duration", () => {
  it("counts only the time the page was visible", () => {
    let now = start;
    let id = 0;
    const session = new StudySession(
      plan,
      () => now,
      () => `review${String((id += 1))}`,
    );

    // 2 s, then an hour hidden, then 3 s more.
    now += 2000;
    session.pause();
    now += 3_600_000;
    session.pause();
    session.resume();
    now += 3000;
    const first = session.answer("know");
    // Control: the next card, never hidden, counts all its time.
    now += 7000;
    const second = session.answer("know");

    expect(first?.history[0]?.durationMs).toBe(5000);
    expect(second?.history[0]?.durationMs).toBe(7000);
  });

  it("given while hidden, counts the time up to hiding, and the next card starts when shown", () => {
    let now = start;
    let id = 0;
    const session = new StudySession(
      plan,
      () => now,
      () => `review${String((id += 1))}`,
    );

    now += 4000;
    session.pause();
    now += 300_000;
    const first = session.answer("know");
    now += 300_000;
    session.resume();
    now += 6000;
    const second = session.answer("know");

    expect(first?.history[0]?.durationMs).toBe(4000);
    expect(second?.history[0]?.durationMs).toBe(6000);
  });
});

describe("the study screen", () => {
  let postgrest: FakePostgrest;
  let visibility: DocumentVisibilityState = "visible";
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    setRequestCookies(await signedInCookies());
    postgrest = new FakePostgrest();
    server.use(...postgrest.handlers);
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Hides or shows the page as the browser does. */
  function set(state: DocumentVisibilityState) {
    visibility = state;
    document.dispatchEvent(new Event("visibilitychange"));
  }

  it("stops the answer clock while the page is hidden", async () => {
    render(<StudyScreen plan={plan} loading={null} />);

    vi.setSystemTime(start + 2000);
    set("hidden");
    vi.setSystemTime(start + 3_602_000);
    set("visible");
    vi.setSystemTime(start + 3_605_000);
    await userEvent.setup().keyboard("{ArrowRight}");

    await waitFor(() => {
      expect(postgrest.rows.reviews).toHaveLength(1);
    });
    expect(postgrest.rows.reviews[0]).toMatchObject({ duration_ms: 5000 });
  });
});
