import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CardId, DeckId } from "@/features/decks";
import { day, start, uuidOf } from "@/testing/library";
import { testUser } from "@/testing/mocks/handlers";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { signedInCookies } from "@/testing/session";

import { StudyScreen } from "../components/study-screen";
import { recordAnswer } from "../record-answer";
import { loadEngine } from "../engine";
import init, { reviewCard, reviewNewCard } from "../engine-wasm/knowno_engine_wasm.js";
import type { CardState } from "../queue";
import type { StudyCard } from "../session";
import { unknownPace } from "../study-time";

/** A day with no answer stored in it before the session. */
const noAnswerToday = {
  answers: [],
  answeredAnyDeck: false,
  streakBefore: 0,
};

vi.mock("next/headers", () => import("@/testing/next-headers"));

const iso = (time: number) => new Date(time).toISOString();

const card: StudyCard = {
  id: uuidOf("c1") as CardId,
  deckId: "d1" as DeckId,
  front: [{ kind: "text", text: "chat" }],
  back: [{ kind: "text", text: "cat" }],
  createdAt: start - day,
  text: { front: "chat", back: "cat" },
};

/**
 * The state the engine's module gives [card] after [answer] at [at] with [fuzzFactor], from
 * [before], called directly rather than through the app's engine wrapper.
 */
async function expected(
  before: CardState | null,
  answer: "know" | "dontKnow",
  at: number,
  fuzzFactor: number,
) {
  await init();
  const seconds = BigInt(Math.trunc(at / 1000));
  const outcome = before
    ? reviewCard(
        {
          stability: before.stability,
          difficulty: before.difficulty,
          lastReview: BigInt(before.lastReview / 1000),
        },
        answer,
        seconds,
        fuzzFactor,
      )
    : reviewNewCard(answer, seconds, fuzzFactor);
  if (!("ok" in outcome)) throw new Error(`the engine refused: ${outcome.error.kind}`);
  return {
    stability: outcome.ok.state.stability,
    difficulty: outcome.ok.state.difficulty,
    lastReview: Number(outcome.ok.state.lastReview) * 1000,
    due: Number(outcome.ok.due) * 1000,
  };
}

/** The stored fuzz factor of the session's only review. */
function storedFactor(postgrest: FakePostgrest): number {
  const factor = postgrest.rows.reviews[0]?.fuzz_factor;
  if (typeof factor !== "number") throw new Error("the review carries no fuzz factor");
  return factor;
}

beforeAll(loadEngine);

describe("recordAnswer", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    setRequestCookies(await signedInCookies());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses a card id that is not a uuid and writes nothing, and stores the same answer under its uuid", async () => {
    const postgrest = new FakePostgrest();
    server.use(...postgrest.handlers);
    const answer = (cardId: string) =>
      recordAnswer({
        cardId: cardId as CardId,
        review: {
          id: "0192a6f0-0000-7000-8000-000000000001",
          answer: "know",
          reviewedAt: start,
          durationMs: 1000,
          fuzzFactor: 0.5,
        },
        change: "answer",
        state: { stability: 3, difficulty: 5, lastReview: start, due: start + 3 * day },
        editedAt: start,
      });

    expect(await answer("c1")).toMatchObject({ saved: false });
    expect([postgrest.rows.reviews, postgrest.rows.card_states]).toEqual([[], []]);
    // Control: the same answer to the card's uuid is stored.
    expect(await answer(uuidOf("c1"))).toEqual({ saved: true });
    expect(postgrest.rows.card_states.map((row) => row.card_id)).toEqual([uuidOf("c1")]);
  });
});

describe("a study session's writes", () => {
  let postgrest: FakePostgrest;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    setRequestCookies(await signedInCookies());
    postgrest = new FakePostgrest();
    server.use(...postgrest.handlers);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes one review per answer and the card state the engine computes", async () => {
    // A long interval, so each fuzz factor gives its own due day.
    const before = {
      stability: 1000,
      difficulty: 5,
      lastReview: start - 1000 * day,
      due: start - day,
    };
    render(
      <StudyScreen
        loading={null}
        plan={{
          startedAt: start,
          day: { start: start - day / 2, end: start + day / 2 },
          queue: { cards: [card], backlog: false },
          relearn: [],
          resumed: false,
          earlier: null,
          more: [],
          extra: [],
          before: { [card.id]: before },
          pace: unknownPace,
          today: noAnswerToday,
        }}
      />,
    );

    vi.setSystemTime(start + 4000);
    await userEvent.setup().keyboard("{ArrowRight}");

    await waitFor(() => {
      expect(postgrest.rows.card_states).toHaveLength(1);
    });
    expect(postgrest.rows.reviews).toHaveLength(1);
    expect(postgrest.rows.reviews[0]).toMatchObject({
      user_id: testUser.id,
      card_id: uuidOf("c1"),
      rating: "good",
      reviewed_at: iso(start + 4000),
      duration_ms: 4000,
      updated_at: iso(start + 4000),
    });
    const state = await expected(before, "know", start + 4000, storedFactor(postgrest));
    expect(postgrest.rows.card_states[0]).toMatchObject({
      user_id: testUser.id,
      card_id: uuidOf("c1"),
      stability: state.stability,
      difficulty: state.difficulty,
      last_review: iso(state.lastReview),
      due: iso(state.due),
      updated_at: iso(start + 4000),
    });
    expect(Object.keys(postgrest.rows.card_states[0] ?? {})).not.toContain("deleted_at");
  });

  it("writes each answer's review under a version 7 id in canonical lowercase form, stamped with the answer's time", async () => {
    // Version nibble 7 and variant 10xx (RFC 9562), lowercase, hyphenated.
    const v7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    // Controls: the form refuses a v4 id, as crypto.randomUUID() makes, and an upper-case v7.
    expect("1b4e28ba-2fa1-4d2a-883f-0016d3cca427").not.toMatch(v7);
    expect("0195F2E8-4C00-7ABC-8DEF-0123456789AB").not.toMatch(v7);
    expect("0195f2e8-4c00-7abc-8def-0123456789ab").toMatch(v7);

    render(
      <StudyScreen
        loading={null}
        plan={{
          startedAt: start,
          day: { start: start - day / 2, end: start + day / 2 },
          queue: { cards: [card], backlog: false },
          relearn: [],
          resumed: false,
          earlier: null,
          more: [],
          extra: [],
          before: {},
          pace: unknownPace,
          today: noAnswerToday,
        }}
      />,
    );
    vi.setSystemTime(start + 4000);
    await userEvent.setup().keyboard("{ArrowRight}");

    await waitFor(() => {
      expect(postgrest.rows.reviews).toHaveLength(1);
    });
    const id = postgrest.rows.reviews[0]?.id;
    expect(id).toMatch(v7);
    // Its first 48 bits are the milliseconds the answer was given at.
    expect(String(id).replaceAll("-", "").slice(0, 12)).toBe(
      (start + 4000).toString(16).padStart(12, "0"),
    );
  });

  it("schedules a new card's first answer from no state", async () => {
    render(
      <StudyScreen
        loading={null}
        plan={{
          startedAt: start,
          day: { start: start - day / 2, end: start + day / 2 },
          queue: { cards: [card], backlog: false },
          relearn: [],
          resumed: false,
          earlier: null,
          more: [],
          extra: [],
          before: {},
          pace: unknownPace,
          today: noAnswerToday,
        }}
      />,
    );

    vi.setSystemTime(start + 4000);
    await userEvent.setup().keyboard("{ArrowLeft}");

    await waitFor(() => {
      expect(postgrest.rows.card_states).toHaveLength(1);
    });
    expect(postgrest.rows.reviews[0]).toMatchObject({ rating: "again", duration_ms: 4000 });
    const state = await expected(null, "dontKnow", start + 4000, storedFactor(postgrest));
    expect(postgrest.rows.card_states[0]).toMatchObject({
      stability: state.stability,
      difficulty: state.difficulty,
      due: iso(state.due),
    });
  });

  it("rewrites a toggled answer by replaying it with its stored fuzz factor", async () => {
    // A long interval, so each fuzz factor gives its own due day.
    const before = {
      stability: 1000,
      difficulty: 5,
      lastReview: start - 1000 * day,
      due: start - day,
    };
    render(
      <StudyScreen
        loading={null}
        plan={{
          startedAt: start,
          day: { start: start - day / 2, end: start + day / 2 },
          queue: { cards: [card], backlog: false },
          relearn: [],
          resumed: false,
          earlier: null,
          more: [],
          extra: [],
          before: { [card.id]: before },
          pace: unknownPace,
          today: noAnswerToday,
        }}
      />,
    );
    const user = userEvent.setup();
    const stateEditedAt = (at: number) => async () => {
      await waitFor(() => {
        expect(postgrest.rows.card_states[0]?.updated_at).toBe(iso(at));
      });
    };
    const toggle = async (at: number) => {
      vi.setSystemTime(at);
      await user.click(
        within(screen.getByRole("complementary", { name: "이번 학습" })).getByRole("button"),
      );
      await stateEditedAt(at)();
    };
    const answeredAt = start + 2000;
    vi.setSystemTime(answeredAt);
    await user.keyboard("{ArrowRight}");
    await stateEditedAt(answeredAt)();
    const fuzzFactor = storedFactor(postgrest);
    const known = await expected(before, "know", answeredAt, fuzzFactor);

    await toggle(start + 3000);
    const unknown = await expected(before, "dontKnow", answeredAt, fuzzFactor);
    expect(postgrest.rows.reviews).toHaveLength(1);
    expect(postgrest.rows.reviews[0]).toMatchObject({
      rating: "again",
      fuzz_factor: fuzzFactor,
      updated_at: iso(start + 3000),
    });
    expect(postgrest.rows.card_states[0]).toMatchObject({
      stability: unknown.stability,
      due: iso(unknown.due),
    });

    await toggle(start + 4000);
    expect(postgrest.rows.reviews[0]).toMatchObject({ rating: "good", fuzz_factor: fuzzFactor });
    expect(postgrest.rows.card_states[0]).toMatchObject({
      stability: known.stability,
      difficulty: known.difficulty,
      last_review: iso(known.lastReview),
      due: iso(known.due),
    });
    // Control: another factor schedules the answer to another day, so the stored one was used.
    const otherFactor = await expected(before, "know", answeredAt, (fuzzFactor + 0.5) % 1);
    expect(otherFactor.due).not.toBe(known.due);
  });
});
