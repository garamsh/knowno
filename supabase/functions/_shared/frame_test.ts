// The frame's reader held to `supabase/fixtures/card-frame/`, the cases the app's
// `card_frame_test.dart` and the web's `card-frame.test.ts` read.
import assert from "node:assert/strict";
import conversions from "../../fixtures/card-frame/conversion.json" with {
  type: "json",
};
import validity from "../../fixtures/card-frame/validity.json" with {
  type: "json",
};
import {
  blocksOut,
  cellsOf,
  frameKey,
  frameProblem,
  parseCells,
  searchText,
} from "./frame.ts";

const earlier = (front: unknown, back: unknown) => ({
  front,
  back,
  template: "free",
  template_version: 1,
});

Deno.test("the fixtures reach the cases the frame's readers share", () => {
  assert.equal(conversions.length, 23);
  assert.equal(validity.length, 13);
  assert.ok(validity.some(({ problem }) => problem === null));
  assert.ok(validity.some(({ problem }) => problem === "shape"));
  assert.ok(validity.some(({ problem }) => problem === "nothing_before"));
  assert.ok(validity.some(({ problem }) => problem === "nothing_added"));
});

for (const { name, front, back, cells } of conversions) {
  Deno.test(`converts as the app and the web: ${name}`, () => {
    const read = cellsOf(earlier(front, back));
    if (cells === null) {
      assert.ok(read?.some(({ kind }) => kind === "unknown"));
      return;
    }
    const expected = parseCells(cells);
    assert.notEqual(expected, null);
    assert.deepEqual(read, expected);
  });
}

for (const { name, blocks, problem } of validity) {
  Deno.test(`holds the frame's validity: ${name}`, () => {
    const cells = parseCells(blocks);
    assert.equal(cells === null ? "shape" : frameProblem(cells), problem);
  });
}

Deno.test("a free v2 card reads its front as its 칸, a card of another template reads its sides", () => {
  const glue = { type: "text", v: 2, payload: { front: "a", back: "b" } };
  const framed = { front: [glue], back: [], template: "free" };
  assert.deepEqual(cellsOf({ ...framed, template_version: 2 }), [
    { kind: "text", front: "a", back: "b" },
  ]);
  const old = { type: "text", v: 1, payload: { text: "a" } };
  assert.deepEqual(
    cellsOf(earlier([old], [{ ...old, payload: { text: "b" } }])),
    [{ kind: "text", front: "a", back: "b" }],
  );
});

Deno.test("a block of a later version reads as an unknown block, which counts for both sides", () => {
  const later = { type: "text", v: 9, payload: {} };
  const cells = cellsOf({
    front: [later],
    back: [],
    template: "free",
    template_version: 3,
  });
  assert.ok(cells !== null);
  assert.deepEqual(blocksOut(cells), [{
    type: "unknown",
    stored_type: "text",
  }]);
  assert.equal(frameProblem(cells), null);
});

const word = (ask: string) => [{
  type: "senses",
  v: 2,
  payload: {
    term: "apple",
    ask,
    senses: [{
      labels: [{ kind: "part_of_speech", category: "noun", text: "명" }],
      meaning: "사과",
      examples: ["An apple."],
    }],
  },
}];
const keys: [string, unknown[], string][] = [
  [
    "a 글's front alone, normalized",
    [{ type: "text", v: 2, payload: { front: " ＲＵＮ  Fast ", back: "x" } }],
    "run fast",
  ],
  ["a 단어's asked word", word("term"), "apple"],
  ["a 단어's asked meanings", word("meaning"), "[명] 사과"],
  [
    "a filled 빈칸 문장",
    [{
      type: "cloze",
      v: 1,
      payload: { text: "The ___ is ___", answers: ["sky", "Blue"] },
    }],
    "the sky is blue",
  ],
  [
    "a filled 표 row by row",
    [{
      type: "table",
      v: 2,
      payload: {
        columns: ["A", "B"],
        rows: [["c", "d"]],
        blanks: [{ row: 0, column: 1 }],
        spans: [],
      },
    }],
    "a | b c | d",
  ],
  [
    "a 사진's media id and box answers, a back 사진 left out",
    [
      {
        type: "image",
        v: 2,
        payload: {
          media: "M1",
          width: 9,
          height: 9,
          boxes: [{ id: "x", x: 0, y: 0, w: 1, h: 1, answer: "Lid" }],
        },
      },
      {
        type: "image",
        v: 2,
        payload: {
          media: "M2",
          width: 9,
          height: 9,
          boxes: [],
          side: "back",
        },
      },
    ],
    "m1 lid",
  ],
  [
    "each part in 칸 order, on lines collapsed to spaces",
    [
      { type: "text", v: 2, payload: { front: "name", back: "" } },
      { type: "cloze", v: 1, payload: { text: "x ___", answers: ["y"] } },
    ],
    "name x y",
  ],
];

for (const [name, blocks, key] of keys) {
  Deno.test(`the card key is ${name}`, () => {
    const cells = parseCells(blocks);
    assert.ok(cells !== null);
    assert.equal(frameKey(cells), key);
  });
}

Deno.test("search reads every 칸 revealed: a 글's back, a blank's answer, an example and a box's answer", () => {
  const cells = parseCells([
    { type: "text", v: 2, payload: { front: "", back: "added" } },
    { type: "cloze", v: 1, payload: { text: "___", answers: ["filled"] } },
    ...word("term"),
    {
      type: "image",
      v: 2,
      payload: {
        media: "secret-id",
        width: 9,
        height: 9,
        boxes: [{ id: "x", x: 0, y: 0, w: 1, h: 1, answer: "lid" }],
      },
    },
  ]);
  assert.ok(cells !== null);
  const text = searchText(cells);
  for (const held of ["added", "filled", "An apple.", "사과", "lid"]) {
    assert.ok(text.includes(held), held);
  }
  assert.ok(!text.includes("secret-id"));
});
