import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { cardRow, day, deckRow, reviewRow, start } from "@/testing/library";
import { setRequestCookies } from "@/testing/next-headers";
import { signedInCookies } from "@/testing/session";

import { loadEngine } from "../engine";
import { readRecord } from "../read-record";
import { readToday } from "../read-today";

vi.mock("next/headers", () => import("@/testing/next-headers"));

// 기록's read folds the cards through the engine.
beforeAll(async () => {
  await loadEngine();
}, 30_000);

describe("readToday's week", () => {
  let postgrest: FakePostgrest;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start + 5 * 3_600_000);
    setRequestCookies(await signedInCookies());
    postgrest = new FakePostgrest();
    server.use(...postgrest.handlers);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts each of the last seven study days' distinct cards, today's last, as 기록 counts its study days", async () => {
    postgrest.seed("decks", deckRow("d-fr", "French"));
    for (const name of ["chat", "chien", "oiseau"]) {
      postgrest.seed("cards", cardRow(`fr-${name}`, "d-fr", name));
    }
    // Today: two cards, one of them twice; the day before: one; six days back, the week's
    // first: one; seven days back, outside it: one.
    postgrest.seed(
      "reviews",
      reviewRow("r1", "fr-chat", start + 3_600_000, 3000),
      reviewRow("r2", "fr-chat", start + 2 * 3_600_000, 3000),
      reviewRow("r3", "fr-chien", start + 3 * 3_600_000, 3000),
      reviewRow("r4", "fr-oiseau", start - day + 3_600_000, 3000),
      reviewRow("r5", "fr-chat", start - 6 * day + 3_600_000, 3000),
      reviewRow("r6", "fr-chien", start - 7 * day + 3_600_000, 3000),
    );

    const read = await readToday({ week: true });
    const record = await readRecord();
    if (!("today" in read) || !("record" in record)) throw new Error("both reads succeed");

    expect(read.today.week.map((week) => week.cards)).toEqual([1, 0, 0, 0, 0, 1, 2]);
    // The same answers read by 기록 give the same seven days.
    expect(read.today.week).toEqual(record.record.studyDays.slice(-7));
    // Control: without the week asked for, none is read.
    const plain = await readToday();
    if (!("today" in plain)) throw new Error("the read succeeds");
    expect(plain.today.week).toEqual([]);
  });
});
