// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  cellsFromSides,
  type Content,
  frameProblem,
  holdsBlank,
  parseCardContent,
  parseCells,
  parseContent,
  shownParts,
  sidesOf,
  spokenCells,
} from "../card-content";

/** The shared cases the app's `card_frame_test.dart` reads (ADR 0137, ADR 0140). */
function fixture<T>(file: string): T[] {
  const root = path.join(import.meta.dirname, "../../../../..");
  const text = readFileSync(path.join(root, "supabase/fixtures/card-frame", file), "utf8");
  return JSON.parse(text) as T[];
}

const conversions = fixture<{
  name: string;
  front: unknown;
  back: unknown;
  cells: unknown;
}>("conversion.json");
const validity = fixture<{ name: string; blocks: unknown; problem: string | null }>(
  "validity.json",
);

/** A side's stored blocks, parsed, which every fixture's are. */
function blocks(side: unknown): Content[] {
  const read = parseContent(side);
  if (!read) throw new Error("a fixture's side did not parse");
  return read;
}

const text = (value: string, v = 1) => ({ type: "text", v, payload: { text: value } });
const cloze = { type: "cloze", v: 1, payload: { text: "___ is red.", answers: ["Rose"] } };

describe("the shared fixtures", () => {
  it("hold each placement, O2, O3 and the unknown blocks", () => {
    const names = conversions.map(({ name }) => name);
    for (const part of [
      ...[1, 2, 3, 4, 5, 6, 7].map((placement) => `placement ${String(placement)}`),
      "O2",
      "O3",
      "back blank beside a front blank",
      "no blank",
      "leaves the card",
    ]) {
      expect(
        names.filter((name) => name.includes(part)),
        part,
      ).not.toEqual([]);
    }
  });

  it.each(conversions)("converts: $name", ({ front, back, cells }) => {
    const expected = cells === null ? null : parseCells(cells);
    if (cells !== null) expect(expected).not.toBeNull();
    const read = parseCardContent({ front, back, template: "free", templateVersion: 1 });
    expect(read?.readOnly ? null : read?.cells).toEqual(expected);
  });

  it.each(validity)("validity: $name", ({ blocks: stored, problem }) => {
    const cells = parseCells(stored);
    if (problem === "shape") {
      expect(cells).toBeNull();
      return;
    }
    expect(cells).not.toBeNull();
    expect(frameProblem(cells ?? [])).toBe(problem);
  });
});

describe("parseCells", () => {
  const box = { id: "x", x: 0, y: 0, w: 1, h: 1 };
  const image = (payload: object) => ({
    type: "image",
    v: 2,
    payload: { media: "m", width: 9, height: 9, ...payload },
  });

  it("refuses a 사진's side beside a box, and a side missing without one", () => {
    expect(parseCells([image({ boxes: [box], side: "front" })])).toBeNull();
    expect(parseCells([image({ boxes: [] })])).toBeNull();
    // Control: each with its side as the rule has it.
    expect(parseCells([image({ boxes: [box] })])).not.toBeNull();
    expect(parseCells([image({ boxes: [], side: "front" })])).not.toBeNull();
  });

  it("refuses what is not a list and a block of an id that is not text", () => {
    const glue = { type: "text", v: 2, payload: { front: "a", back: "b" } };
    expect(parseCells({})).toBeNull();
    expect(parseCells([{ ...glue, id: 1 }])).toBeNull();
    // Control: the same block with a text id.
    expect(parseCells([{ ...glue, id: "b1" }])).toEqual([
      { kind: "text", front: "a", back: "b", id: "b1" },
    ]);
  });

  it("keeps a 칸 of a later version, which counts as a question", () => {
    const cells = parseCells([{ type: "text", v: 4, payload: { front: "a", back: "" } }]);
    expect(cells).toEqual([{ kind: "unknown", block: { kind: "unsupported", type: "text" } }]);
    expect(frameProblem(cells ?? [])).toBeNull();
  });
});

describe("the sides of a list of 칸", () => {
  const word = (ask: "term" | "meaning") =>
    parseCells([
      {
        type: "senses",
        v: 2,
        payload: {
          term: "apple",
          ask,
          senses: [{ labels: [], meaning: "사과", examples: [] }],
        },
      },
    ]) ?? [];
  const senses = {
    kind: "senses",
    senses: [{ labels: [], meaning: "사과", examples: [] }],
  } as const;

  it("puts a 단어's asked part on the front and its other part on the back", () => {
    expect(sidesOf(word("term"))).toEqual({
      front: [{ kind: "text", text: "apple" }],
      back: [senses],
    });
    expect(sidesOf(word("meaning"))).toEqual({
      front: [senses],
      back: [{ kind: "text", text: "apple" }],
    });
  });

  it("shows what the reveal adds only once revealed, each 칸 in place", () => {
    const cells =
      parseCells([
        { type: "text", v: 2, payload: { front: "", back: "after" } },
        cloze,
        { type: "text", v: 2, payload: { front: "before", back: "added" } },
      ]) ?? [];

    expect(shownParts(cells, false).map(({ block }) => describeOne(block))).toEqual([
      "Rose is red.",
      "before",
    ]);
    expect(shownParts(cells, true).map(({ block }) => describeOne(block))).toEqual([
      "after",
      "Rose is red.",
      "before",
      "added",
    ]);
    expect(spokenCells(cells, false)).toBe("빈칸 is red.. before");
    expect(spokenCells(cells, true)).toBe("after. Rose is red.. before. added");
  });
});

/** The text of a text or cloze [block], filled. */
function describeOne(block: Content): string {
  if (block.kind === "text") return block.text;
  if (block.kind === "cloze") return block.text.replace("___", block.answers[0] ?? "");
  throw new Error("a text or a cloze is expected");
}

describe("whether a card is drawn whole", () => {
  const cellsOf = (front: unknown[], back: unknown[]) =>
    cellsFromSides(blocks(front), blocks(back)) ?? [];

  it("reads every 칸, so a blank on a back alone makes it whole", () => {
    expect(holdsBlank(cellsOf([text("Fill it")], [cloze]))).toBe(true);
    expect(holdsBlank(cellsOf([cloze], []))).toBe(true);
    // Control: a literal ___ is text, on either side.
    expect(holdsBlank(cellsOf([text("The ___ sat.")], [text("___")]))).toBe(false);
  });
});

describe("parseCardContent", () => {
  const stored = (front: unknown, back: unknown, template: unknown, templateVersion: unknown) => ({
    front,
    back,
    template,
    templateVersion,
  });

  it("reads a free v2 card's list, and its sides from it", () => {
    const list = [{ type: "text", v: 2, payload: { front: "a", back: "b" } }];
    expect(parseCardContent(stored(list, [], "free", 2))).toEqual({
      cells: [{ kind: "text", front: "a", back: "b" }],
      front: [{ kind: "text", text: "a" }],
      back: [{ kind: "text", text: "b" }],
    });
  });

  it("refuses a free v2 card whose list breaks its shape", () => {
    const empty = [{ type: "text", v: 2, payload: { front: " ", back: "" } }];
    expect(parseCardContent(stored(empty, [], "free", 2))).toBeNull();
    // Control: the template decides how it is read: at v1 the block is unknown, not refused.
    expect(parseCardContent(stored(empty, [], "free", 1))).not.toBeNull();
  });

  it.each([
    [undefined, undefined],
    [null, null],
    ["free", 1],
    ["flip", 1],
    ["cloze", 1],
    ["table", 1],
  ])("converts a card of template %s at version %s", (template, version) => {
    expect(parseCardContent(stored([text("a")], [text("b")], template, version))?.cells).toEqual([
      { kind: "text", front: "a", back: "b" },
    ]);
  });

  it("keeps the sides of a card holding an unknown block, and of a later template", () => {
    const chart = { type: "chart", payload: {} };
    const unknown = parseCardContent(stored([text("a")], [chart, cloze], "free", 1));
    expect(unknown?.front).toEqual([{ kind: "text", text: "a" }]);
    expect(unknown?.back).toHaveLength(2);
    // Its blank still makes it whole, so no answer is drawn at the prompt, and what this build
    // cannot show follows the rest, as the phone's `cellsToDraw` keeps it.
    expect(holdsBlank(unknown?.cells ?? [])).toBe(true);
    expect(unknown?.cells.map(({ kind }) => kind)).toEqual(["text", "blank", "unknown"]);

    const later = parseCardContent(stored([text("a")], [text("b")], "free", 3));
    expect(later?.front).toEqual([{ kind: "text", text: "a" }]);
    expect(later?.back).toEqual([{ kind: "text", text: "b" }]);
    expect(parseCardContent(stored([cloze], [text("Rose is red.")], "flip", 2))?.back).toHaveLength(
      1,
    );
    // Control: the same card at a version earlier builds wrote drops its derived back.
    expect(parseCardContent(stored([cloze], [text("Rose is red.")], "flip", 1))?.back).toEqual([]);
  });
});
