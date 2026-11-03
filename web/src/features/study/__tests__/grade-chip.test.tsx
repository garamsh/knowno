import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { chipTone } from "@/testing/chip";

import type { CardId, DeckId } from "@/features/decks";

import { GradedCard, GradeChip } from "../components/graded-card";

describe("a grade's chip", () => {
  it("draws 안다 and 모른다 in the one chip, each in its grade's tone, hidden from screen readers", () => {
    render(
      <>
        <GradeChip answer="know" />
        <GradeChip answer="dontKnow" />
      </>,
    );

    expect(chipTone(screen.getByText("안다"))).toBe("know");
    expect(chipTone(screen.getByText("모른다"))).toBe("dont-know-text");
    expect(screen.getByText("안다").closest("[aria-hidden]")).not.toBeNull();
  });
});

describe("the previous card's focus ring", () => {
  it("is drawn inside the button's box, on its radius, where the clipping wrapper cannot cut it", () => {
    render(
      <GradedCard
        answer={{
          card: {
            id: "c" as CardId,
            deckId: "d" as DeckId,
            front: [{ kind: "text", text: "chat" }],
            back: [{ kind: "text", text: "cat" }],
            createdAt: 0,
            text: { front: "chat", back: "cat" },
            frontLength: 4,
          },
          answer: "know",
        }}
        onOpen={() => undefined}
      />,
    );

    const button = screen.getByRole("button");
    expect(button).toHaveClass("focus-visible:outline-2", "focus-visible:-outline-offset-2");
    expect(button).not.toHaveClass("focus-visible:outline-offset-2");
  });
});
