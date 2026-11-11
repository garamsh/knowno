import { describe, expect, it } from "vitest";

import { builtCells, cellDraft, type CellDraft, cellProblem, encodeCells } from "../authoring";
import { parseCells } from "../card-content";
import { splitPaste } from "../markdown-paste";
import {
  clozeAt,
  continueList,
  hideSelection,
  nextClozeNumber,
  removeCloze,
} from "../markup-editing";

const text = (v: number, front: string, back = "") => ({
  type: "text",
  v,
  id: "t",
  payload: { front, back },
});

/** What [drafts] are stored as, which must save. */
function saved(...drafts: CellDraft[]) {
  const { cells } = builtCells(drafts);
  if (!cells) throw new Error("the drafts do not save");
  return encodeCells(cells);
}

/** The draft of a stored 글 or cloze block. */
function opened(block: unknown): CellDraft {
  const [cell] = parseCells([block]) ?? [];
  if (!cell || cell.kind === "unknown") throw new Error("the block did not open");
  return cellDraft(cell);
}

describe("a 글 the editor saves", () => {
  it("is markup as typed, version 3", () => {
    const draft: CellDraft = { kind: "text", id: "t", front: "**apple** and a_b", back: "- x" };

    expect(saved(draft)).toEqual([text(3, "**apple** and a_b", "- x")]);
  });

  it("keeps a version 3 글 as markup when opened and when edited", () => {
    const draft = opened(text(3, "**a**", "c"));
    if (draft.kind !== "text") throw new Error("not a 글");

    expect(saved(draft)).toEqual([text(3, "**a**", "c")]);
    expect(saved({ ...draft, front: "**b**" })).toEqual([text(3, "**b**", "c")]);
  });

  it.each([1, 2])(
    "does not open a version %i 글, which the build reads as one it does not know",
    (v) => {
      const [cell] = parseCells([text(v, "2*3*4", "- a")]) ?? [];

      expect(cell?.kind).toBe("unknown");
    },
  );

  it("does not open a version 1 cloze, which the build reads as one it does not know", () => {
    const [cell] =
      parseCells([
        { type: "cloze", v: 1, id: "c", payload: { text: "___ is red", answers: ["Rose"] } },
      ]) ?? [];

    expect(cell?.kind).toBe("unknown");
  });

  it("is typed text as markup: a typed `*` marks and is not escaped, as the editor shows it", () => {
    const [block] = saved({ kind: "text", id: "t", front: "2*3*4", back: "x" });

    expect(block).toMatchObject({ v: 3, payload: { front: "2*3*4" } });
  });
});

describe("a 빈칸 문장 the editor saves", () => {
  it("is its text in Anki's syntax, version 2, once it holds a cloze", () => {
    const draft: CellDraft = { kind: "anki", id: "c", source: "{{c1::Paris::city}} is big" };

    expect(cellProblem(draft)).toBeNull();
    expect(saved(draft)).toEqual([
      { type: "cloze", v: 2, id: "c", payload: { text: "{{c1::Paris::city}} is big" } },
    ]);
  });

  it("says a text with no cloze needs one, and does not save it", () => {
    const draft: CellDraft = { kind: "anki", id: "c", source: "Paris is big" };

    expect(cellProblem(draft)).toBe("빈칸을 하나 이상 넣어 주세요");
    expect(builtCells([draft]).cells).toBeNull();
    // Control: an escaped cloze is not one either.
    expect(cellProblem({ ...draft, source: "\\{\\{c1\\:\\:a\\}\\}" })).not.toBeNull();
  });

  it("opens a stored version 2 as its text", () => {
    expect(opened({ type: "cloze", v: 2, id: "c", payload: { text: "{{c2::a}}" } })).toEqual({
      kind: "anki",
      id: "c",
      source: "{{c2::a}}",
    });
  });
});

describe("the editor's actions on a cloze text", () => {
  it("takes the smallest cloze number not used, so a gap is filled", () => {
    expect(nextClozeNumber("")).toBe(1);
    expect(nextClozeNumber("{{c1::a}}")).toBe(2);
    expect(nextClozeNumber("{{c1::a}} {{c3::b}}")).toBe(2);
    expect(nextClozeNumber("{{c2::a}}")).toBe(1);
    // Control: a number inside code is no cloze.
    expect(nextClozeNumber("`{{c1::a}}`")).toBe(1);
  });

  it("wraps a selection in the next free number, and a caret in an empty cloze with the caret inside", () => {
    expect(hideSelection("Paris is big", 0, 5)).toEqual({
      text: "{{c1::Paris}} is big",
      start: 6,
      end: 11,
    });
    expect(hideSelection("{{c1::a}} b", 10, 11)).toMatchObject({ text: "{{c1::a}} {{c2::b}}" });
    expect(hideSelection("ab", 1, 1)).toEqual({ text: "a{{c1::}}b", start: 7, end: 7 });
  });

  it("finds the cloze a selection is in, and gives its answer back without its hint", () => {
    const text = "x {{c1::Paris::city}} y {{c2::Rome}}";

    expect(clozeAt(text, 10, 10)).toEqual({ start: 2, end: 21, answer: "Paris" });
    expect(clozeAt(text, 0, 0)).toBeNull();
    expect(clozeAt(text, 22, 22)).toBeNull();
    // A selection running past the cloze's end is in none.
    expect(clozeAt(text, 10, 24)).toBeNull();
    const at = clozeAt(text, 10, 10);
    expect(at && removeCloze(text, at)).toEqual({
      text: "x Paris y {{c2::Rome}}",
      start: 7,
      end: 7,
    });
  });

  it("continues a list at a line break, numbers going on, and ends it on an empty item", () => {
    expect(continueList("- a", 3)).toEqual({ text: "- a\n- ", start: 6, end: 6 });
    expect(continueList("1. a\n2. b", 9)).toEqual({ text: "1. a\n2. b\n3. ", start: 13, end: 13 });
    expect(continueList("  - a", 5)).toEqual({ text: "  - a\n  - ", start: 10, end: 10 });
    expect(continueList("- a\n- ", 6)).toEqual({ text: "- a\n\n", start: 5, end: 5 });
    expect(continueList("plain", 5)).toBeNull();
    // A break in the middle of an item continues it after the caret.
    expect(continueList("- ab", 3)).toEqual({ text: "- a\n- b", start: 6, end: 6 });
  });
});

describe("a pasted Markdown text", () => {
  it("is one 글 where it holds neither a table nor an image", () => {
    expect(splitPaste("# Title\n\n- a\n- b")).toEqual([
      { kind: "text", text: "# Title\n\n- a\n- b" },
    ]);
    expect(splitPaste("")).toEqual([]);
  });

  it("makes a table of its header, its delimiter row and its rows, short rows filled", () => {
    expect(splitPaste("| word | meaning |\n| --- | :-: |\n| apple | 사과 |\n| pear |")).toEqual([
      {
        kind: "table",
        columns: ["word", "meaning"],
        rows: [
          ["apple", "사과"],
          ["pear", ""],
        ],
      },
    ]);
  });

  it("keeps a table of headers alone as text", () => {
    expect(splitPaste("| a | b |\n| - | - |")).toEqual([
      { kind: "text", text: "| a | b |\n| - | - |" },
    ]);
  });

  it("makes a line that is an https image a 사진, and the rest around it 글", () => {
    expect(
      splitPaste(
        "before\n![cat](https://images.test/cat.png)\nafter\n![x](http://images.test/x.png)",
      ),
    ).toEqual([
      { kind: "text", text: "before" },
      { kind: "image", url: "https://images.test/cat.png" },
      { kind: "text", text: "after\n![x](http://images.test/x.png)" },
    ]);
  });

  it("splits a mixed paste into its parts in order", () => {
    expect(
      splitPaste(
        'intro\n| a | b |\n|---|---|\n| 1 | 2 |\n![](https://i.test/a.jpg "title")\noutro',
      ),
    ).toEqual([
      { kind: "text", text: "intro" },
      { kind: "table", columns: ["a", "b"], rows: [["1", "2"]] },
      { kind: "image", url: "https://i.test/a.jpg" },
      { kind: "text", text: "outro" },
    ]);
  });
});
