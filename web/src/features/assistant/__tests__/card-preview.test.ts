import { describe, expect, it } from "vitest";

import { markupFixtures } from "@/testing/markup-fixtures";

import { previewOf } from "../card-preview";

describe("a proposed card's two lines", () => {
  it("reads a 글's front and back as markup, its marks left out", () => {
    expect(
      previewOf({
        blocks: [{ type: "text", front: "**apple** is *red*", back: "- 사과\n- 과일" }],
      }),
    ).toEqual({ front: "apple is red", back: "사과\n과일" });
  });

  it("shows a cloze of version 2 as blanks in its text with each hint after it, and its answers as the back", () => {
    expect(
      previewOf({
        blocks: [
          { type: "cloze", text: "{{c1::Paris::city}} is {{c2::the capital}} of {{c1::France}}" },
        ],
      }),
    ).toEqual({ front: "___(city) is ___ of ___", back: "Paris, the capital, France" });
  });

  // Code keeps its text as written, braces included, so a fixture holding code is left out.
  it.each(
    markupFixtures.cloze.filter(({ numbers, input }) => numbers.length > 0 && !input.includes("`")),
  )("never shows raw cloze syntax for $name", ({ input }) => {
    const { front, back } = previewOf({ blocks: [{ type: "cloze", text: input }] });

    expect(front).toContain("___");
    expect(front).not.toMatch(/\{\{c\d/u);
    expect(back).not.toBe("");
  });

  it("leaves the other forms as they were", () => {
    expect(previewOf({ front: " a ", back: "b", labels: ["명"] })).toEqual({
      front: "a",
      back: "[명] b",
    });
    expect(
      previewOf({ blocks: [{ type: "table", columns: ["a", "b"], rows: [["1", "2"]] }] }),
    ).toEqual({ front: "a · b", back: "1 · 2" });
  });
});
