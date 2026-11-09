import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { uuidOf } from "@/testing/library";

import { DeckList } from "../components/deck-list";
import { type Deck, parseDeckId } from "../library";
import { refusalSentence } from "../refusal";

function deckOf(screening?: Deck["screening"], isPublic = false): Deck {
  const id = parseDeckId(uuidOf("d"));
  if (!id) throw new Error("the fixed id is a uuid");
  return { id, name: "French", public: isPublic, ...(screening && { screening }) };
}

describe("a note's screening state on the 노트 list", () => {
  it("marks a note being checked or held 확인 중 and a refused one 공개 안 됨, never 공개", () => {
    for (const [screening, word] of [
      ["checking", "확인 중"],
      ["held", "확인 중"],
      ["refused", "공개 안 됨"],
    ] as const) {
      const { unmount } = render(
        <DeckList rows={[{ deck: deckOf(screening), cards: 0, today: 0 }]} />,
      );
      const row = screen.getByRole("link", { name: /^French/ });
      expect(row).toHaveAccessibleName(`French, 카드 0장, ${word}`);
      expect(within(row).getByText(word)).toBeVisible();
      expect(within(row).queryByText("공개")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("marks a public note 공개 and no other state, against one that is none", () => {
    render(<DeckList rows={[{ deck: deckOf(undefined, true), cards: 0, today: 0 }]} />);
    expect(screen.getByRole("link", { name: /^French/ })).toHaveAccessibleName(
      "French, 카드 0장, 공개",
    );
  });
});

describe("the owner's sentence for a refusal", () => {
  it("names the first finding's category, says the admin decided for an admin refusal, and never leaks a term", () => {
    expect(refusalSentence("rules", [{ category: "phone" }])).toBe(
      "전화번호가 들어 있어서 공개할 수 없어요.",
    );
    expect(refusalSentence("rules", [{ category: "term", start: 0, end: 2 }])).toBe(
      "허용되지 않는 표현이 들어 있어서 공개할 수 없어요.",
    );
    expect(refusalSentence("admin", [{ category: "phone" }])).toBe(
      "운영자가 이 노트를 공개할 수 없다고 판단했어요.",
    );
    expect(refusalSentence("rules", [])).toBe("이 노트는 공개할 수 없어요.");
    expect(refusalSentence(null, null)).toBe("이 노트는 공개할 수 없어요.");
  });
});
