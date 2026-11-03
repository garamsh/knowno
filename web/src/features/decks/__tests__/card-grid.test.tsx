import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { blanksUnder, hatchedBlanksUnder } from "@/testing/whole-cards";

import { type Cell, sidesOf } from "../card-content";
import { CardGrid } from "../components/card-grid";
import type { Card, CardId, Deck, DeckId } from "../library";

const deck: Deck = { id: "d" as DeckId, name: "한국사", public: false };

/** A card of [cells], its sides as they read. */
function card(id: string, cells: Cell[]): Card {
  return { id: id as CardId, deckId: deck.id, createdAt: 0, cells, ...sidesOf(cells) };
}

/** The note's card list holding [cells] as its one card, and that card's row. */
function row(cells: Cell[]): HTMLElement {
  render(<CardGrid deck={deck} cards={[card("c", cells)]} />);
  // A row's name carries its whole card, so the one row is found by what every row's name holds.
  return within(screen.getByRole("region", { name: "카드" })).getByRole("button", {
    name: /, 뒷면 /,
  });
}

/** The boxes on the hatch under [element], each its text. */
const hatched = (element: HTMLElement) =>
  [...element.querySelectorAll("[data-hatched]")].map((box) => {
    expect(box).toHaveClass("hatch");
    return box.textContent;
  });

describe("a note's card list row (#629)", () => {
  it("has no 뒷면 보기 switch: every card is shown whole when the page opens", () => {
    render(
      <CardGrid
        deck={deck}
        cards={[card("a", [{ kind: "text", front: "조선의 최고 법전은?", back: "경국대전" }])]}
      />,
    );
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText("뒷면 보기")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "조선의 최고 법전은?, 뒷면 경국대전" }),
    ).toBeVisible();
  });

  it("shows a 글's front, then its back in a hatched box", () => {
    const shown = row([{ kind: "text", front: "조선의 최고 법전은?", back: "경국대전" }]);
    expect(hatched(shown)).toEqual(["경국대전"]);
    expect(shown).toHaveTextContent(/^조선의 최고 법전은\?경국대전$/);
  });

  it("shows a 단어's word, then its meanings in a hatched box", () => {
    const shown = row([
      {
        kind: "word",
        term: "ephemeral",
        senses: [{ labels: [], meaning: "덧없는", examples: [] }],
        ask: "term",
      },
    ]);
    expect(hatched(shown)).toEqual(["덧없는"]);
    expect(shown).toHaveTextContent(/^ephemeral덧없는$/);
  });

  it("shows a 빈칸's sentence with each blank filled on the hatch, none empty", () => {
    const shown = row([
      {
        kind: "blank",
        block: {
          kind: "cloze",
          text: "세종대왕은 ___년에 ___을 창제했다.",
          answers: ["1443", "훈민정음"],
        },
      },
    ]);
    expect(hatchedBlanksUnder(shown)).toEqual(["1443", "훈민정음"]);
    expect(blanksUnder(shown)).toEqual({ "1443": false, 훈민정음: false });
    for (const blank of shown.querySelectorAll("[data-blank]")) {
      expect(blank).toHaveClass("hatch");
      expect(blank).not.toHaveClass("text-transparent");
    }
  });

  it("shows a 표's first three rows, its hidden cells on the hatch, and how many rows it leaves", () => {
    const rows = [
      ["태종", "호패법"],
      ["세종", "훈민정음"],
      ["세조", "직전법"],
      ["성종", "경국대전"],
      ["연산군", "무오사화"],
    ];
    const shown = row([
      {
        kind: "blank",
        block: {
          kind: "table",
          columns: ["왕", "업적"],
          rows,
          blanks: rows.map((_, at) => ({ row: at, column: 1 })),
          spans: [],
        },
      },
    ]);
    expect(hatchedBlanksUnder(shown)).toEqual(["호패법", "훈민정음", "직전법"]);
    expect(within(shown).getByText("외 2행")).toBeInTheDocument();
    expect(shown).not.toHaveTextContent("성종");
    // Control: a shown cell is drawn, off the hatch.
    expect(shown).toHaveTextContent("태종");
  });

  it("draws a 사진's boxes on the hatch over its photo, and its answers on the hatch under it", () => {
    const shown = row([
      {
        kind: "blank",
        block: {
          kind: "image",
          media: "m",
          width: 4,
          height: 3,
          boxes: [
            { id: "a", x: 0.1, y: 0.1, w: 0.3, h: 0.2, answer: "한양" },
            { id: "b", x: 0.5, y: 0.6, w: 0.3, h: 0.2, answer: "개성" },
          ],
        },
      },
    ]);
    const boxes = [...shown.querySelectorAll("[data-box]")];
    expect(boxes.map((box) => box.getAttribute("data-box"))).toEqual(["marked", "marked"]);
    for (const box of boxes) {
      expect(box).toHaveClass("hatch");
      expect(box).toBeEmptyDOMElement();
    }
    expect(hatched(shown)).toEqual(["한양 · 개성"]);
  });

  it("cuts a long card at two lines shown and three on the hatch, wrapping between words", () => {
    const long = Array.from({ length: 60 }, () => "낱말").join(" ");
    const split = row([{ kind: "text", front: `앞 ${long}`, back: `뒤 ${long}` }]);
    const front = within(split).getByText(`앞 ${long}`).closest(".line-clamp-2");
    expect(front).toHaveClass("break-keep");
    const back = within(split).getByText(`뒤 ${long}`).closest(".line-clamp-3");
    expect(back).toHaveClass("break-keep");
    expect(back?.closest("[data-hatched]")).not.toBeNull();
  });

  it("cuts a whole card's shown part at two lines and its added part at three", () => {
    const long = Array.from({ length: 60 }, () => "낱말").join(" ");
    const whole = row([
      { kind: "blank", block: { kind: "cloze", text: `___ ${long}`, answers: ["답"] } },
      { kind: "text", front: `앞 ${long}`, back: `뒤 ${long}` },
    ]);
    expect(within(whole).getByText(`앞 ${long}`)).toHaveClass("line-clamp-2", "break-keep");
    expect(within(whole).getByText(`뒤 ${long}`)).toHaveClass("line-clamp-3", "break-keep");
    expect(whole.querySelector("[data-blank]")?.closest(".line-clamp-2")).not.toBeNull();
  });
});
