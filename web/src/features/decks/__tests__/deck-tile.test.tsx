import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeckTile } from "../components/deck-tile";
import type { Deck, DeckId } from "../library";

const id = "00000000-0000-4000-8000-000000000001" as DeckId;

/** The one tile [deck] draws: its fill's theme utility and its icon's Lucide name. */
function tile(deck: Partial<Deck>) {
  const { container } = render(<DeckTile deck={{ id, name: "French", public: false, ...deck }} />);
  const box = container.firstElementChild;
  const icon = box?.querySelector("svg");
  return {
    box,
    fill: box?.className.split(" ").find((name) => name.startsWith("bg-")),
    icon: icon
      ?.getAttribute("class")
      ?.split(" ")
      .find((name) => name.startsWith("lucide-")),
  };
}

describe("a deck's tile", () => {
  it.each([
    // DeckIcon in app/lib/deck/src/model.dart, each key with the icon deckIconData draws.
    ["layers", "lucide-layers"],
    ["book", "lucide-book-open"],
    ["languages", "lucide-languages"],
    ["pencil", "lucide-pencil"],
    ["flask", "lucide-flask-conical"],
    ["calculator", "lucide-calculator"],
    ["globe", "lucide-globe"],
    ["music", "lucide-music"],
    ["palette", "lucide-palette"],
    ["brain", "lucide-brain"],
    ["code", "lucide-code"],
    ["landmark", "lucide-landmark"],
    ["briefcase", "lucide-briefcase"],
    ["star", "lucide-star"],
  ])("draws the stored icon %s as the app does, %s", (key, lucide) => {
    expect(tile({ icon: key }).icon).toBe(lucide);
  });

  it("draws the stored colour, and hides the tile from screen readers with no initial", () => {
    const { box, fill } = tile({ icon: "book", color: "violet" });

    expect(fill).toBe("bg-deck-peach");
    expect(box).toHaveAttribute("aria-hidden", "true");
    expect(box).not.toHaveTextContent("F");
  });

  it("draws layers on the brand tint for a deck with no keys, or with keys this version does not know", () => {
    expect(tile({})).toMatchObject({ icon: "lucide-layers", fill: "bg-brand-tint" });
    expect(tile({ icon: "rocket", color: "teal" })).toMatchObject({
      icon: "lucide-layers",
      fill: "bg-brand-tint",
    });
    // Control: a known pair is drawn as stored, so the default above is the fallback's.
    expect(tile({ icon: "star", color: "amber" })).toMatchObject({
      icon: "lucide-star",
      fill: "bg-deck-amber",
    });
  });

  it("draws a stored photo covering the tile, its icon under it for while the photo cannot be read, against a deck with none", () => {
    const { box, icon } = tile({ icon: "book", imageUrl: "https://signed/photo" });
    const photo = box?.querySelector("[style*='background-image']");
    expect(photo).toHaveStyle({ backgroundImage: 'url("https://signed/photo")' });
    expect(photo).toHaveClass("absolute", "inset-0", "bg-cover", "bg-center");
    expect(box).toHaveClass("overflow-hidden", "rounded-field");
    expect(icon).toBe("lucide-book-open");
    expect(tile({ icon: "book" }).box?.querySelector("[style*='background-image']")).toBeNull();
  });
});
