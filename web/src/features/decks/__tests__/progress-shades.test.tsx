import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { uuidOf } from "@/testing/library";

import { DeckList } from "../components/deck-list";
import { parseDeckId } from "../library";

describe("a deck row's progress bar", () => {
  it("draws mastered in the accent and learning in the chart's quiet colour, with no gap between the shares, as the phone does", () => {
    const id = parseDeckId(uuidOf("d-fr"));
    if (!id) throw new Error("the fixed id is a uuid");
    render(
      <DeckList
        rows={[
          {
            deck: { id, name: "French", publication: "private" as const },
            cards: 4,
            today: 0,
            mastered: 1,
            learning: 2,
          },
        ]}
      />,
    );

    // A row's name carries its counts after the deck's name, so its start is matched.
    const row = screen.getByRole("link", { name: /^French/ });
    const share = (width: string) =>
      Array.from(row.querySelectorAll<HTMLElement>("span[style]")).find(
        (span) => span.style.width === width,
      );
    const mastered = share("25%");
    const learning = share("50%");
    expect(mastered?.className.split(" ")).toEqual(["bg-accent"]);
    expect(learning?.className.split(" ")).toEqual(["bg-chart-quiet"]);
    // The two shares sit side by side in one track, with nothing between them.
    expect(learning?.parentElement).toBe(mastered?.parentElement);
    expect(learning?.parentElement?.className.split(" ")).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^gap-/)]),
    );
  });
});

describe("a deck row's line", () => {
  const french = parseDeckId(uuidOf("d-fr"));
  const empty = parseDeckId(uuidOf("d-empty"));
  if (!french || !empty) throw new Error("the fixed ids are uuids");
  const rows = [
    {
      deck: { id: french, name: "French", publication: "private" as const },
      cards: 4,
      today: 2,
      mastered: 1,
      learning: 2,
    },
    {
      deck: { id: empty, name: "Empty", publication: "private" as const },
      cards: 0,
      today: 0,
      mastered: 0,
      learning: 0,
    },
  ];
  /** Whether [later] comes after [earlier] in the document. */
  const follows = (earlier: Node, later: Node) =>
    (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it("states the mastered of all cards under the name and over the bar, and the row's name ends with the bar's three counts", () => {
    render(<DeckList rows={rows} />);

    const row = screen.getByRole("link", { name: /^French/ });
    expect(row).toHaveAccessibleName(
      "French, 카드 4장, 오늘 2, 4장 중 1장 익힘, 익힘 1장, 학습 중 2장, 새 카드 1장",
    );
    const line = within(row).getByText("4장 중 1장 익힘");
    const bar = row.querySelector("span[style]")?.parentElement;
    if (!bar) throw new Error("the deck with cards draws its bar");
    // Under the name, and over the bar.
    expect(follows(within(row).getByText("French"), line)).toBe(true);
    expect(follows(line, bar)).toBe(true);
    // No line of the learning count: the row's name carries it.
    expect(within(row).queryByText(/학습 중/)).not.toBeInTheDocument();
  });

  it("shows a deck with no card as 0장, with no bar and no counts in its name", () => {
    render(<DeckList rows={rows} />);

    const row = screen.getByRole("link", { name: /^Empty/ });
    expect(row).toHaveAccessibleName("Empty, 카드 0장");
    expect(within(row).getByText("0장")).toBeInTheDocument();
    // The bar is its hairline track; an empty share draws no width, so the track is looked for.
    expect(row.querySelector(".bg-edge")).toBeNull();
    expect(within(row).queryByText(/익힘/)).not.toBeInTheDocument();
    // Control: the deck with cards draws its bar, so the query finds one where there is one.
    const french = screen.getByRole("link", { name: /^French/ });
    expect(french.querySelector(".bg-edge")).not.toBeNull();
  });

  it('ends the row in a brand "오늘 n" chip beside the name, so the bar runs under it to the row\'s inner end (#845)', () => {
    render(<DeckList rows={rows} />);

    const row = screen.getByRole("link", { name: /^French/ });
    const chip = within(row).getByText("오늘 2");
    expect(chip).toHaveClass("bg-brand-tint");
    // The chip shares the name's line, in the text column, which the bar spans.
    const name = within(row).getByText("French");
    expect(chip.parentElement).toBe(name.parentElement);
    const bar = row.querySelector("span[style]")?.parentElement;
    expect(bar?.parentElement).toBe(chip.parentElement?.parentElement);
    // Nothing follows the column in the row but the column itself: no bare count at its end.
    expect(row.lastElementChild).toBe(chip.parentElement?.parentElement);
    // Control: a deck with nothing to study today draws no chip.
    const empty = screen.getByRole("link", { name: /^Empty/ });
    expect(within(empty).queryByText(/^오늘/)).not.toBeInTheDocument();
  });
});
