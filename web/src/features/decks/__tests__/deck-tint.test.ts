// @vitest-environment node
import { describe, expect, it } from "vitest";

import { deckColor, deckColors, deckFill } from "../deck-tint";
import type { DeckId } from "../library";

const id = "00000000-0000-4000-8000-000000000001" as DeckId;

describe("a deck's colour", () => {
  it("is the palette in the app's order, each drawn with its theme token", () => {
    // DeckColor in app/lib/deck/src/model.dart, in its order.
    expect(deckColors).toEqual(["blue", "sky", "violet", "amber", "slate", "sand"]);
    expect(deckColors.map(deckFill)).toEqual([
      "bg-deck-blue",
      "bg-deck-sky",
      "bg-deck-peach",
      "bg-deck-amber",
      "bg-deck-slate",
      "bg-deck-sand",
    ]);
  });

  it("is the stored one when this version knows it, and otherwise none, on the brand tint", () => {
    expect(deckFill(deckColor({ id, name: "", public: false, color: "amber" }))).toBe(
      "bg-deck-amber",
    );
    // Control: the same deck with no key, and with keys this version does not know.
    for (const color of [undefined, "teal", "constructor"]) {
      expect(deckFill(deckColor({ id, name: "", public: false, color }))).toBe("bg-brand-tint");
    }
  });
});
