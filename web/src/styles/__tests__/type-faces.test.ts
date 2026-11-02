// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const src = path.join(import.meta.dirname, "../..");
const globalsCss = readFileSync(path.join(src, "styles/globals.css"), "utf8");
const read = (file: string) => readFileSync(path.join(src, file), "utf8");

/** The `text-*` styles globals.css draws in Jua. */
const juaStyles = [
  ...globalsCss.matchAll(/@utility text-([a-z-]+) \{\s*font-family: var\(--font-display\);/g),
].map(([, name]) => String(name));

describe("which text Jua draws", () => {
  it("is the titles, figures and buttons we write", () => {
    expect(juaStyles.sort()).toEqual([
      "button",
      "deck-title",
      "display",
      "figure",
      "headline",
      "label",
      "title",
    ]);
  });

  it("is never a card's text or a deck's name", () => {
    // Control: the deck's name and a card's front are drawn in these styles.
    expect(read("features/decks/components/card-grid.tsx")).toMatch(
      /className="[^"]*text-deck-name[^"]*">\{deck\.name\}/,
    );
    expect(read("features/decks/components/deck-list.tsx")).toMatch(
      /className="[^"]*text-body-strong">\{deck\.name\}/,
    );
    expect(read("features/study/components/card-side.tsx")).toContain("text-front");

    for (const style of ["deck-name", "front", "back", "whole-front", "card-body", "body-strong"]) {
      expect(juaStyles).not.toContain(style);
    }
  });

  it("falls back to Pretendard at the weight its styles ask for, thickening nothing", () => {
    expect(globalsCss).toContain("--font-display: var(--font-jua), var(--font-sans);");
    expect(globalsCss).toContain("font-synthesis: none;");
    expect(read("app/layout.tsx")).toMatch(/Jua-Regular\.ttf",\s*weight: "800"/);
    const weights = juaStyles.map(
      (style) => new RegExp(`--text-${style}--font-weight: (\\d+);`).exec(globalsCss)?.[1],
    );
    expect(new Set(weights)).toEqual(new Set(["800"]));
  });
});
