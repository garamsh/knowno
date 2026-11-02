// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { CardId } from "@/features/decks";

import {
  deckProgress,
  chartDays,
  masteredIntervalDays,
  progressOf,
  nextReviewOf,
} from "../overview";
import { studyDay } from "../queue";

// The cases of app/test/study/overview_test.dart, so the two clients define the same figures.

const day = 86_400_000;
/** 09:00 UTC on 14 October 2026, five hours into the study day in UTC. */
const now = Date.UTC(2026, 9, 14, 9);
const id = (value: string) => value as CardId;

describe("a card's progress", () => {
  it("is mastered from an interval of 21 days, learning below it, and new without a review", () => {
    const at = now - 30 * day;
    expect(progressOf({ stability: 1, difficulty: 5, lastReview: at, due: at + 21 * day })).toBe(
      "mastered",
    );
    expect(
      progressOf({ stability: 1, difficulty: 5, lastReview: at, due: at + 21 * day - 1000 }),
    ).toBe("learning");
    expect(progressOf(undefined)).toBe("fresh");
  });

  it("counts a deck's cards by progress, each once", () => {
    const at = now - 30 * day;
    expect(
      deckProgress([{ id: id("a") }, { id: id("b") }, { id: id("c") }], {
        [id("a")]: { stability: 1, difficulty: 5, lastReview: at, due: at + 30 * day },
        [id("b")]: { stability: 1, difficulty: 5, lastReview: at, due: at + 2 * day },
      }),
    ).toEqual({ mastered: 1, learning: 1, fresh: 1 });
  });
});

describe("the next review", () => {
  const due = (at: number) => ({ stability: 1, difficulty: 5, lastReview: at - day, due: at });
  const today = studyDay(now, [], "UTC", 20);

  it("is the first later day with a card due, each day from 04:00 to 04:00", () => {
    expect(
      nextReviewOf(
        [
          // Due today, before the day ends: not a later day's.
          due(Date.UTC(2026, 9, 15, 3, 59)),
          // 04:00 starts tomorrow's study day.
          due(Date.UTC(2026, 9, 15, 4)),
          due(Date.UTC(2026, 9, 16, 3, 59)),
          due(Date.UTC(2026, 9, 16, 4)),
        ],
        today,
        "UTC",
      ),
    ).toEqual({ after: 1, cards: 2 });
    // The last of the seven days ends at 04:00 on 21 October.
    expect(nextReviewOf([due(Date.UTC(2026, 9, 21, 3, 59))], today, "UTC")).toEqual({
      after: 6,
      cards: 1,
    });
    expect(
      nextReviewOf(
        [due(Date.UTC(2026, 9, 15, 3, 59)), due(Date.UTC(2026, 9, 21, 4))],
        today,
        "UTC",
      ),
    ).toBeNull();
  });

  it("follows 04:00 local time across a change of offset", () => {
    // 11:00 on 31 October 2025 in Los Angeles; 03:00 and 03:59 on 2 November, at UTC-8 after the
    // change, are still 1 November's.
    const before = studyDay(Date.UTC(2025, 9, 31, 18), [], "America/Los_Angeles", 20);
    expect(
      nextReviewOf(
        [due(Date.UTC(2025, 10, 2, 11)), due(Date.UTC(2025, 10, 2, 11, 59))],
        before,
        "America/Los_Angeles",
      ),
    ).toEqual({ after: 1, cards: 2 });
  });
});

describe("the overview's constants", () => {
  it("are app/lib/study/src/overview.dart's", () => {
    const root = path.join(import.meta.dirname, "../../../../..");
    const dart = readFileSync(path.join(root, "app/lib/study/src/overview.dart"), "utf8");
    expect(/^const chartDays = (\d+);$/m.exec(dart)?.[1]).toBe(String(chartDays));
    expect(/^const masteredInterval = Duration\(days: (\d+)\);$/m.exec(dart)?.[1]).toBe(
      String(masteredIntervalDays),
    );
  });
});
