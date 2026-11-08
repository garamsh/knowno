import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { markupFixtures } from "@/testing/markup-fixtures";
import { boxedBlanksUnder } from "@/testing/whole-cards";

import { frameKey } from "../authoring";
import { encodeCells } from "../authoring";
import {
  type Cell,
  describeContent,
  parseCardContent,
  parseCells,
  plainText,
  sidesOf,
  spokenCells,
} from "../card-content";
import { CardGrid } from "../components/card-grid";
import { faceLength, WholeCells } from "../components/whole-card";
import type { Card, CardId, Deck, DeckId } from "../library";

const text = (v: number, front: string, back = "") => ({
  type: "text",
  v,
  id: "t",
  payload: { front, back },
});
const cloze = (v: number, payload: Record<string, unknown>) => ({
  type: "cloze",
  v,
  id: "c",
  payload,
});

/** The 칸 of [blocks], which must read. */
function cells(...blocks: unknown[]): Cell[] {
  const read = parseCells(blocks);
  if (!read) throw new Error("the fixture did not parse");
  return read;
}

describe("a 글 of version 3", () => {
  it("is read as markup, and one of version 2 as written, though both hold the same text", () => {
    const [markup] = cells(text(3, "**apple**", "- a\n- b"));
    const [literal] = cells(text(2, "**apple**", "- a\n- b"));

    expect(markup).toMatchObject({ kind: "text", front: "**apple**", marks: { front: {} } });
    expect(literal).toEqual({ kind: "text", front: "**apple**", back: "- a\n- b", id: "t" });
    expect(describeContent(sidesOf([markup as Cell]).front)).toBe("apple");
    expect(describeContent(sidesOf([literal as Cell]).front)).toBe("**apple**");
  });

  it("draws bold, italic and code in a card, a list on lines with markers and its back once revealed", () => {
    const drawn = cells(text(3, "**bold** *it* `code`", "- one\n- two\n  - nested"));
    const { container, rerender } = render(<WholeCells cells={drawn} revealed={false} />);

    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("em")).toHaveTextContent("it");
    expect(container.querySelector("code")).toHaveTextContent("code");
    expect(container).not.toHaveTextContent("one");

    rerender(<WholeCells cells={drawn} revealed />);
    expect(
      [...container.querySelectorAll("[data-markup]")].map((line) => line.textContent),
    ).toEqual(["bold it code", "• one", "• two", "  ◦ nested"]);
  });

  it("draws a version 2 글 as written, its asterisks and hyphens kept", () => {
    const { container } = render(
      <WholeCells cells={cells(text(2, "**bold**", "- one"))} revealed />,
    );

    expect(container.querySelector("strong")).toBeNull();
    expect(container).toHaveTextContent("**bold**");
    expect(container).toHaveTextContent("- one");
  });

  it("keeps every newline of the text as a line of its own", () => {
    const { container } = render(<WholeCells cells={cells(text(3, "a\n\n\nb"))} revealed />);

    expect(
      [...container.querySelectorAll("[data-markup]")].map((line) => line.textContent),
    ).toEqual(["a", "", "", "b"]);
  });

  it("keys the card by its plain text, so a marked front and a plain one are duplicates", () => {
    expect(frameKey(cells(text(3, "**Apple**")))).toBe("apple");
    expect(frameKey(cells(text(3, "- Apple")))).toBe("apple");
    expect(frameKey(cells(text(2, "**Apple**")))).toBe("**apple**");
    expect(plainText(sidesOf(cells(text(3, "a *b*", "c"))).front)).toBe("a b");
  });

  it("measures a front by what it reads, not by its marks", () => {
    const [marked] = cells(text(3, "**ab**"));
    const [plain] = cells(text(3, "ab"));

    expect(faceLength(sidesOf([marked as Cell]).front)).toBe(2);
    expect(faceLength(sidesOf([plain as Cell]).front)).toBe(2);
  });

  it("is stored again as version 3 with its text as read, and a version 2 as version 2", () => {
    const stored = [text(3, "**a**", "b"), text(2, "*c*")];

    expect(
      encodeCells(cells(...stored).flatMap((cell) => (cell.kind === "unknown" ? [] : [cell]))),
    ).toEqual(stored);
  });

  it("is refused where a part is not text, and a later version is kept as it is", () => {
    expect(parseCells([{ type: "text", v: 3, payload: { front: "a" } }])).toBeNull();
    expect(parseCells([text(4, "a")])).toEqual([
      { kind: "unknown", block: { kind: "unsupported", type: "text", id: "t" } },
    ]);
  });
});

describe("a cloze of version 2", () => {
  const source = "{{c1::Paris::city}} is {{c2::the capital}} of {{c1::France}}";

  it("is read from its text in Anki's syntax, answers none", () => {
    const [read] = cells(cloze(2, { text: source }));

    expect(read).toMatchObject({
      kind: "blank",
      block: {
        kind: "cloze",
        text: source,
        answers: [],
        markup: { plain: "Paris is the capital of France" },
      },
    });
    expect(describeContent(sidesOf([read as Cell]).front)).toBe("Paris is the capital of France");
  });

  it("is kept as read when it holds no cloze, as a block of a later version is", () => {
    const content = parseCardContent({
      front: [cloze(2, { text: "no cloze here" })],
      back: [],
      template: "free",
      templateVersion: 2,
    });

    expect(content?.readOnly).toBe(true);
    expect(content?.cells).toEqual([
      { kind: "unknown", block: { kind: "unsupported", type: "cloze", id: "c" } },
    ]);
  });

  it("leaves a version 1 cloze as it was drawn, its blanks in place", () => {
    const [read] = cells(cloze(1, { text: "___ is red", answers: ["Rose"] }));

    expect(read).toMatchObject({ kind: "blank", block: { text: "___ is red", answers: ["Rose"] } });
    expect(read).not.toMatchObject({ block: { markup: expect.anything() as unknown } });
  });

  it("is stored again as its text alone, version 2", () => {
    const stored = cloze(2, { text: source });

    expect(
      encodeCells(cells(stored).flatMap((cell) => (cell.kind === "unknown" ? [] : [cell]))),
    ).toEqual([stored]);
  });

  it("hides every span as a blank in place, a hint in it, and fills them once revealed", () => {
    const drawn = cells(cloze(2, { text: source }));
    const { container, rerender } = render(<WholeCells cells={drawn} revealed={false} />);

    const blanks = [...container.querySelectorAll('[data-blank="empty"]')];
    expect(blanks).toHaveLength(3);
    expect(blanks[0]).toHaveTextContent("city");
    expect(container.querySelector('[data-blank="filled"]')).toBeNull();
    expect(container).toHaveTextContent(" is ");
    expect(spokenCells(drawn, false)).toBe("빈칸 is 빈칸 of 빈칸");

    rerender(<WholeCells cells={drawn} revealed />);
    expect(
      [...container.querySelectorAll('[data-blank="filled"]')].map((blank) => blank.textContent),
    ).toEqual(["Paris", "the capital", "France"]);
    expect(spokenCells(drawn, true)).toBe("Paris is the capital of France");
  });

  it("is a box on the hatch on study's card, wide enough for its hint, and its answer filled once revealed", () => {
    const drawn = cells(cloze(2, { text: "{{c1::Paris::city}} and {{c2::Rome}}" }));
    const { container, rerender } = render(<WholeCells cells={drawn} revealed={false} studied />);

    const boxes = [...container.querySelectorAll<HTMLElement>('[data-blank="boxed"]')];
    expect(boxes.map((box) => box.textContent)).toEqual(["city", ""]);
    expect(boxes[0]?.style.minWidth).toBe("2em");
    expect(boxes[1]?.style.width).toBe("2em");
    expect(container).not.toHaveTextContent("Paris");

    rerender(<WholeCells cells={drawn} revealed studied />);
    expect(container).toHaveTextContent("Paris and Rome");
    expect(boxedBlanksUnder(container)).toBe(0);
  });

  it("measures its front with each span as one blank's width", () => {
    const [read] = cells(cloze(2, { text: "ab {{c1::long answer}}" }));

    expect(faceLength(sidesOf([read as Cell]).front)).toBe(3 + 2);
  });

  it.each(markupFixtures.cloze.filter(({ numbers }) => numbers.length > 0))(
    "hides each span of $name together, as many blanks as the fixture's hidden documents hold",
    ({ input, hidden }) => {
      // Every span is a blank on the card, whatever its number: the fixtures hide one number at a
      // time, so a span is a blank in exactly one of their documents.
      const spans = Object.values(hidden)
        .flat()
        .reduce((sum, block) => sum + JSON.stringify(block).split('"type":"blank"').length - 1, 0);
      const drawn = cells(cloze(2, { text: input }));
      const { container } = render(<WholeCells cells={drawn} revealed={false} />);

      expect(container.querySelectorAll('[data-blank="empty"]')).toHaveLength(spans);
    },
  );
});

describe("a note's card list over markup cards", () => {
  const deck: Deck = { id: "d" as DeckId, name: "노트", public: false };
  const card = (read: Cell[]): Card => ({
    id: "c" as CardId,
    deckId: deck.id,
    createdAt: 0,
    cells: read,
    ...sidesOf(read),
  });

  it("shows a marked 글 formatted in its row and names it by what it reads", () => {
    render(<CardGrid deck={deck} cards={[card(cells(text(3, "**apple**", "*사과*")))]} />);

    const row = within(screen.getByRole("region", { name: "카드" })).getByRole("button", {
      name: "apple, 뒷면 사과",
    });
    expect(row.querySelector("strong")).toHaveTextContent("apple");
    expect(row.querySelector("em")).toHaveTextContent("사과");
  });

  it("shows a cloze v2 with its blanks filled on the hatch", () => {
    render(
      <CardGrid deck={deck} cards={[card(cells(cloze(2, { text: "{{c1::Paris}} is big" })))]} />,
    );

    const row = within(screen.getByRole("region", { name: "카드" })).getByRole("button", {
      name: /, 뒷면 /,
    });
    expect(row.querySelector('[data-blank="marked"]')).toHaveTextContent("Paris");
    expect(row).not.toHaveTextContent("{{");
  });
});
