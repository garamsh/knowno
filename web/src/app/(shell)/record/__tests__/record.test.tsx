import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { otherUser } from "@/testing/mocks/handlers";
import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { cardRow, day, deckRow, reviewRow, start, stateRow } from "@/testing/library";
import { layOutLines, zoomOf } from "@/testing/line-widths";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";
import { typeSizesOf } from "@/testing/type-sizes";

import { RecordContent } from "../_components/record";

vi.mock("next/headers", () => import("@/testing/next-headers"));

/** A review of [card] [ago] before [start], "안다" unless [know] is false. */
function answer(id: string, card: string, ago: number, know = true) {
  return { ...reviewRow(id, card, start - ago, 6000), rating: know ? "good" : "again" };
}

/** A stored state reviewed [ago] before [start] with an interval of [interval]. */
const state = (card: string, ago: number, interval: number) =>
  stateRow(card, {
    stability: 5,
    difficulty: 5,
    lastReview: start - ago,
    due: start - ago + interval,
  });

/** The chart or bar whose label starts with [prefix]: its whole label. */
const label = (prefix: string) =>
  screen.getByRole("img", { name: new RegExp(`^${prefix}`) }).getAttribute("aria-label");

describe("the record page", () => {
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

  /**
   * A history in Seoul, the zone without a cookie: card a reviewed "안다" 20 and 3 days back; b
   * "모른다" 3 days back with a re-show; a card since deleted "안다" 3 days back; c first answered
   * yesterday; and d "모른다" 40 days back, after its first answer 60 days back.
   */
  function seedHistory() {
    postgrest.seed("decks", deckRow("deck", "French"));
    postgrest.seed(
      "cards",
      cardRow("a", "deck", "chat"),
      cardRow("b", "deck", "chien"),
      cardRow("c", "deck", "oiseau"),
      cardRow("d", "deck", "poisson"),
      cardRow("gone", "deck", "vache", day, true),
    );
    postgrest.seed(
      "reviews",
      answer("a1", "a", 25 * day),
      answer("a2", "a", 20 * day),
      answer("a3", "a", 3 * day),
      answer("b1", "b", 10 * day),
      answer("b2", "b", 3 * day, false),
      answer("b3", "b", 3 * day - 5 * 60_000),
      answer("g1", "gone", 10 * day),
      answer("g2", "gone", 3 * day),
      answer("c1", "c", day),
      answer("d1", "d", 60 * day),
      answer("d2", "d", 40 * day, false),
    );
    postgrest.seed(
      "card_states",
      state("a", 3 * day, 12 * day),
      state("b", 3 * day, day),
      state("c", day, 3 * day),
      state("d", 40 * day, day),
      state("gone", 3 * day, 12 * day),
    );
  }

  it("shows the retention over 30 days by default, then 7 days and every day, with its gap and each day in its label", async () => {
    seedHistory();
    await render(RecordContent, {});

    // 30 days: a's "안다" 20 days back, and a's and the deleted card's "안다" and b's "모른다" 3 days back.
    expect(screen.getByRole("radio", { name: "30일" })).toBeChecked();
    expect(screen.getByText("75%")).toBeInTheDocument();
    // A shortfall's pill is amber; a gain's is green (ADR 0151).
    expect(screen.getByText("목표보다 15% 낮아요")).toHaveClass("bg-tint-amber");
    expect(label("복습에서 맞힌 비율")).toBe(
      "복습에서 맞힌 비율, 목표 90%: 12월 26일 100%, 1월 12일 67%",
    );

    await userEvent.click(screen.getByRole("radio", { name: "7일" }));
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByText("목표보다 23% 낮아요")).toBeInTheDocument();
    expect(label("복습에서 맞힌 비율")).toBe("복습에서 맞힌 비율, 목표 90%: 1월 12일 67%");

    await userEvent.click(screen.getByRole("radio", { name: "전체" }));
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("목표보다 30% 낮아요")).toBeInTheDocument();
  });

  it("draws its charts below the page's title in three sizes, the caption, the body and the display the bands' counts share with the title, the figures apart", async () => {
    seedHistory();
    await render(RecordContent, {});

    // The state it asked for: the retention with its target, which drew a fourth size.
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("목표 90%")).toBeInTheDocument();
    expect(typeSizesOf(document.body)).toEqual([13, 16, 28]);
  });

  it("puts the period selector above the retention, which alone follows it, the chosen period on the primary fill", async () => {
    seedHistory();
    await render(RecordContent, {});

    const region = screen.getByRole("region", { name: "복습에서 맞힌 비율" });
    const retention = within(region);
    const choice = screen.getByRole("radiogroup", { name: "기간" });
    // One selector on the page, before the retention's card and outside it.
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    expect(region.contains(choice)).toBe(false);
    expect(choice.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The chosen period takes the primary fill and its label.
    expect(choice.querySelector('[class*="peer-checked:bg-primary"]')).not.toBeNull();
    expect(choice.querySelector('[class*="peer-checked:text-on-primary"]')).not.toBeNull();
    // Another period changes the retention, and no other card.
    const mastered = screen.getByRole("region", { name: "익힌 카드" }).textContent;
    const days = screen.getByRole("region", { name: "학습한 날" }).textContent;
    await userEvent.click(within(choice).getByRole("radio", { name: "7일" }));
    expect(retention.getByText("67%")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "익힌 카드" }).textContent).toBe(mastered);
    expect(screen.getByRole("region", { name: "학습한 날" }).textContent).toBe(days);
  });

  it("shows the cards mastered now as the mastered card's figure, and names the first and the last week under its bars", async () => {
    seedHistory();
    await render(RecordContent, {});

    const card = within(screen.getByRole("region", { name: "익힌 카드" }));
    // The figure is the label's last week.
    const now = /(\d+)장$/.exec(label("주별 익힌 카드") ?? "")?.[1];
    expect(card.getByText(`${String(now)}장`)).toHaveClass("text-figure");
    expect(card.getByText("7주 전")).toBeInTheDocument();
    expect(card.getByText("이번 주")).toBeInTheDocument();
    // The past weeks in the heatmap's second step, this week in the accent (ADR 0151).
    const bars = [...card.getByRole("img", { name: /^주별 익힌 카드/ }).children];
    expect(bars.map((bar) => bar.className.match(/\bbg-(heat-1|accent)\b/)?.[0])).toEqual([
      ...Array<string>(7).fill("bg-heat-1"),
      "bg-accent",
    ]);
  });

  it.each([
    [49, "1장"],
    [48, "0장"],
  ])(
    "names the first mastered week 7주 전, the week a card mastered %i days before today falls in only at seven weeks",
    async (ago, first) => {
      // A card answered "안다" long before, then again [ago] days back, which masters it.
      postgrest.seed("decks", deckRow("deck", "French"));
      postgrest.seed("cards", cardRow("a", "deck", "chat", 400 * day));
      postgrest.seed("reviews", answer("a1", "a", 300 * day), answer("a2", "a", ago * day));
      await render(RecordContent, {});

      // A prefix: the label goes on with the other six weeks' counts, which this case leaves aside.
      expect(label("주별 익힌 카드")).toMatch(
        new RegExp(`^주별 익힌 카드, 7주 전부터 이번 주까지: ${first}, 1장,`),
      );
      const card = within(screen.getByRole("region", { name: "익힌 카드" }));
      expect(card.getByText("7주 전")).toBeInTheDocument();
    },
  );

  it("rings today's study day and places the grid in time with its first day, 오늘 and a key to its shades", async () => {
    seedHistory();
    await render(RecordContent, {});

    const card = within(screen.getByRole("region", { name: "학습한 날" }));
    // 84 study days back from 15 January: the first is 24 October.
    expect(card.getByText("10월 24일")).toBeInTheDocument();
    expect(card.getByText("오늘")).toBeInTheDocument();
    expect(card.getByText(/적게/)).toHaveTextContent("적게많이");
    const cells = [...card.getByRole("img", { name: /^최근 12주/ }).children];
    expect(cells).toHaveLength(84);
    // Only the last cell, today's, is outlined in ink, clear of its fill.
    expect(
      cells.filter((cell) =>
        ["outline-2", "outline-offset-1", "outline-ink"].every((name) =>
          cell.classList.contains(name),
        ),
      ),
    ).toEqual([cells.at(-1)]);
    // Each cell in one of the four cobalt steps.
    for (const cell of cells) {
      expect([...cell.classList].filter((name) => /^bg-heat-[0-3]$/.test(name))).toHaveLength(1);
    }
  });

  it("names the target on its dashed line at the plot's left and labels no scale, only the axis's ends", async () => {
    seedHistory();
    await render(RecordContent, {});

    const chart = screen.getByRole("img", { name: /^복습에서 맞힌 비율/ });
    // The lowest day, 67%, takes the scale down to 60%, which no label names.
    expect(chart).not.toHaveTextContent("100%");
    expect(chart).not.toHaveTextContent("60%");
    // The target's name sits on its line, a quarter of the way down from 100% to 60%, at the left.
    const target = within(chart).getByText("목표 90%");
    expect(target.closest("svg")).toBeNull();
    expect(target).toHaveClass("left-0");
    expect(Number.parseFloat(target.style.top)).toBeCloseTo(25);
    expect(chart).toHaveTextContent(/30일 전.*오늘/);
  });

  it("shows the recall bands of the cards in the decks, the deleted card's state left out", async () => {
    seedHistory();
    await render(RecordContent, {});

    // a, b, c and d: the deleted card's state is not one of them.
    expect(label("\\d+장 중")).toMatch(/^4장 중 좋음 \d장, 보통 \d장, 곧 잊음 \d장, 평균 \d+%$/);
  });

  it("keeps each band's count on one line, shrunk to its tile only where wider", async () => {
    seedHistory();
    // Each count, "n장", is 40 px: a 20 px tile shrinks it, a 40 px one holds it.
    for (const [tile, zoom] of [
      [20, 0.5],
      [40, 1],
    ] as const) {
      const restore = layOutLines(tile);
      await render(RecordContent, {});
      const bands = screen.getByText("곧 잊음").closest("dl");
      if (!bands) throw new Error("the bands' tiles are drawn");
      const counts = within(bands).getAllByText(/^\d장$/);
      expect(counts).toHaveLength(3);
      for (const count of counts) expect(zoomOf(count), `in a ${String(tile)} px tile`).toBe(zoom);
      restore();
      cleanup();
    }
  });

  it("counts every stored answer in the study days and the streaks, the deleted card's included", async () => {
    seedHistory();
    await render(RecordContent, {});

    expect(screen.getByText("1일 연속 · 최고 1일")).toBeInTheDocument();
    expect(label("최근 12주")).toBe(
      "최근 12주 동안 7일 학습했어요: 11월 16일 1장, 12월 6일 1장, 12월 21일 1장, 12월 26일 1장, 1월 5일 2장, 1월 12일 3장, 1월 14일 1장",
    );
  });

  it("says so in a sentence for each chart with nothing to show", async () => {
    postgrest.seed("decks", deckRow("deck", "French"));
    await render(RecordContent, {});

    expect(screen.getByText("이 기간에 복습한 카드가 없어요.")).toBeInTheDocument();
    // The period stays, so another can be chosen.
    expect(screen.getByRole("radiogroup", { name: "기간" })).toBeInTheDocument();
    expect(screen.getByText("아직 복습한 카드가 없어요.")).toBeInTheDocument();
    expect(screen.getByText("아직 익힌 카드가 없어요.")).toBeInTheDocument();
    expect(label("최근 12주")).toBe("최근 12주 동안 학습한 날이 없어요");
    expect(screen.getByText("0일 연속 · 최고 0일")).toBeInTheDocument();
  });

  it("reads in two requests sent together, and only the signed-in user's rows", async () => {
    seedHistory();
    postgrest.seed("reviews", { ...answer("x1", "a", 2 * day), user_id: otherUser.id });
    await render(RecordContent, {});

    expect(postgrest.requests.toSorted()).toEqual([
      "POST rpc/study_record_cards",
      "POST rpc/study_record_days",
    ]);
    // Another user's answer 2 days back is not a study day of this user's.
    expect(label("최근 12주")).toMatch(/^최근 12주 동안 7일 학습했어요/);
  });

  it("shows why it could not read the record", async () => {
    seedHistory();
    postgrest.fail("reviews", 503);
    await render(RecordContent, {});

    expect(screen.getByRole("alert")).toHaveTextContent(
      "서버에 연결할 수 없어요. 연결을 확인하고 다시 시도해 주세요.",
    );
    expect(screen.queryByText("복습에서 맞힌 비율")).toBeNull();
  });
});
