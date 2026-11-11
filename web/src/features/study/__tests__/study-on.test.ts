import { beforeAll, describe, expect, it } from "vitest";

import type { CardId, DeckId } from "@/features/decks";

import { loadEngine } from "../engine";
import { type SessionPlan, type StudyCard, StudySession } from "../session";
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

/**
 * A session over today's new cards [today] and the new cards past them [more], with [stored]
 * answers given today before it opened, "stored0" first, those named in [extra] past the day's
 * plan and answered "모른다".
 */
function session(
  today: string[],
  more: string[],
  stored = 0,
  earlier: SessionPlan["earlier"] = null,
  extra: string[] = [],
): StudySession {
  const plan: SessionPlan = {
    startedAt: start,
    day: { start: start - 43_200_000, end: start + 43_200_000 },
    queue: { cards: today.map(card), backlog: false },
    relearn: [],
    resumed: false,
    earlier,
    more: more.map(card),
    extra: extra as CardId[],
    before: {},
    pace: unknownPace,
    today: {
      answers: Array.from({ length: stored }, (_, index) => ({
        cardId: `stored${String(index)}` as CardId,
        answer: extra.includes(`stored${String(index)}`)
          ? ("dontKnow" as const)
          : ("know" as const),
        reviewedAt: start - 1000,
        durationMs: 0,
      })),
      answeredAnyDeck: stored > 0,
      streakBefore: 0,
    },
  };
  let id = 0;
  return new StudySession(
    plan,
    () => start,
    () => `review${String((id += 1))}`,
  );
}

/** The front of the card on screen. */
function current(study: StudySession): string {
  const view = study.view();
  if (view.kind !== "studying") throw new Error(`no card is on screen: ${view.kind}`);
  return view.current.id;
}

beforeAll(loadEngine);

describe("studying past today's cards", () => {
  it("goes on from the completion sheet with the new cards past today's, oldest first, each answer written and counted apart from the day's", () => {
    const study = session(["a", "b"], ["c", "d"]);
    study.answer("know");
    study.answer("know");
    const complete = study.view();
    expect(complete).toMatchObject({ kind: "complete", more: true, done: 2, total: 2 });

    study.studyOn();
    expect(current(study)).toBe("c");
    expect(study.answer("know")?.cardId).toBe("c");
    expect(current(study)).toBe("d");
    expect(study.answer("know")?.cardId).toBe("d");
    // The day's count stays at its plan; the two past it are counted apart.
    expect(study.view()).toMatchObject({
      kind: "complete",
      more: false,
      done: 2,
      total: 2,
      extra: 2,
    });
  });

  it("shows a card answered past today's again only as the re-show after 모른다", () => {
    const study = session(["a"], ["b", "c"]);
    study.answer("know");
    study.studyOn();
    const shown: string[] = [];
    for (const answer of ["dontKnow", "know", "know"] as const) {
      shown.push(current(study));
      study.answer(answer);
    }
    expect(shown).toEqual(["b", "c", "b"]);
    expect(study.view()).toMatchObject({ kind: "complete", more: false });
  });

  it("opens straight on the new cards past today's when none is left today, its size holding no card, under the plan's earlier answer until its first", () => {
    // Control: a session with a card left today opens on it, sized.
    expect(session(["a"], ["b"]).size.cards).toBe(1);

    const earlier = { card: card("stored0"), answer: "know" as const };
    const study = session([], ["b", "c"], 1, earlier);
    expect(study.size.cards).toBe(0);
    expect(study.view()).toMatchObject({
      kind: "studying",
      earlier,
      // The day's count stays at the card answered "안다" today.
      done: 1,
      total: 1,
      extra: 0,
    });
    expect(current(study)).toBe("b");
    study.answer("know");
    expect(study.view()).toMatchObject({ kind: "studying", earlier: null, extra: 1 });
  });

  it("leaves a card answered past the day's plan before it opened out of the day's count, its 모른다 included", () => {
    const study = session([], [], 2, null, ["stored1"]);
    expect(study.view()).toMatchObject({ kind: "complete", done: 1, total: 1, extra: 1 });
    // Control: with neither past the plan, both count in the day's.
    expect(session([], [], 2).view()).toMatchObject({ done: 2, total: 2, extra: 0 });
  });

  it("with no card left to take opens on the completion sheet when today holds an answer, and on nothing to study otherwise", () => {
    const answered = session([], [], 1);
    expect(answered.view()).toMatchObject({ kind: "complete", more: false });
    answered.studyOn();
    expect(answered.view()).toMatchObject({ kind: "complete", more: false });

    expect(session([], []).view().kind).toBe("empty");
  });
});

describe("today's list in the session", () => {
  /** A plan over [queue], in a backlog or not, with [relearn] still on 모른다 from earlier today. */
  function plan(queue: string[], relearn: string[], backlog: boolean): SessionPlan {
    return {
      startedAt: start,
      day: { start: start - 43_200_000, end: start + 43_200_000 },
      queue: { cards: queue.map(card), backlog },
      relearn: relearn.map(card),
      resumed: true,
      earlier: null,
      more: [],
      extra: [],
      before: {},
      pace: unknownPace,
      today: {
        answers: relearn.map((front) => ({
          cardId: front as CardId,
          answer: "dontKnow" as const,
          reviewedAt: start - 1000,
          durationMs: 0,
        })),
        answeredAnyDeck: relearn.length > 0,
        streakBefore: 0,
      },
    };
  }

  it("puts a card still on 모른다 after a re-show's gap, in a backlog as out of one", () => {
    for (const backlog of [true, false]) {
      let id = 0;
      const study = new StudySession(
        plan(["o0", "o1", "o2", "o3", "o4", "o5", "o6", "o7"], ["x"], backlog),
        () => start,
        () => `review${String((id += 1))}`,
      );
      const shown: string[] = [];
      while (study.view().kind === "studying") {
        shown.push(current(study));
        study.answer("know");
      }
      const at = shown.indexOf("x");
      expect(at, `backlog ${String(backlog)}`).toBeGreaterThanOrEqual(3);
      expect(at, `backlog ${String(backlog)}`).toBeLessThanOrEqual(5);
    }
  });

  it("counts the session's own answers in the day it opened in, after 04:00 too", () => {
    let now = start;
    let id = 0;
    const study = new StudySession(
      plan(["a", "b"], [], false),
      () => now,
      () => `review${String((id += 1))}`,
    );
    study.answer("know");
    expect(study.view()).toMatchObject({ done: 1, total: 2 });
    // Past the day's end, as a session left open across 04:00.
    now = start + 43_200_000 + 60_000;
    study.answer("know");
    expect(study.view()).toMatchObject({ done: 2, total: 2 });
  });
});
