// @vitest-environment node
import { describe, expect, it } from "vitest";

import { deckColor, deckColors, deckFill, offeredColors } from "../deck-tint";

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

  it("is offered as the four note colours t1 to t4, while a stored sky and amber still draw", () => {
    expect(offeredColors.map(deckFill)).toEqual([
      "bg-deck-blue",
      "bg-deck-peach",
      "bg-deck-sand",
      "bg-deck-slate",
    ]);
    for (const [color, fill] of [
      ["sky", "bg-deck-sky"],
      ["amber", "bg-deck-amber"],
    ]) {
      expect(offeredColors).not.toContain(color);
      expect(deckFill(deckColor({ color }))).toBe(fill);
    }
  });

  it("is the stored one when this version knows it, and otherwise none, on the brand tint", () => {
    expect(deckFill(deckColor({ color: "amber" }))).toBe("bg-deck-amber");
    // Control: the same deck with no key, and with keys this version does not know.
    for (const color of [undefined, "teal", "constructor"]) {
      expect(deckFill(deckColor({ color }))).toBe("bg-brand-tint");
    }
  });
});
