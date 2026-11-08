import { describe, expect, it } from "vitest";

import {
  audioLength,
  audioOf,
  blockVersion,
  cellsFromSides,
  type Content,
  describeContent,
  holdsBlank,
  parseContent,
  plainText,
  spokenContent,
  upcastPayload,
} from "../card-content";

// The cases of the app's `app/test/deck/content_test.dart`: both clients read one stored shape.
const cloze = { type: "cloze", payload: { text: "___ is in ___", answers: ["Paris", "France"] } };
const table = (rows: unknown, blanks: unknown) => ({
  type: "table",
  payload: { columns: ["Capital", "Country"], rows, blanks },
});
const rows = [["Paris", "France"]];
/** Whether a card with [front] alone is drawn whole. */
const isWhole = (front: Content[]) => holdsBlank(cellsFromSides(front, []) ?? []);
const cell = [{ row: 0, column: 0 }];

describe("a card side's blocks", () => {
  it("read a cloze and a table as typed blocks beside text", () => {
    expect(
      parseContent([{ type: "text", payload: { text: "Capitals" } }, cloze, table(rows, cell)]),
    ).toEqual([
      { kind: "text", text: "Capitals" },
      { kind: "cloze", text: "___ is in ___", answers: ["Paris", "France"] },
      { kind: "table", columns: ["Capital", "Country"], rows, blanks: cell, spans: [] },
    ]);
  });

  it("refuse a cloze or a table that breaks its shape, where a whole one is read", () => {
    for (const broken of [
      { type: "cloze", payload: { text: "___ and ___", answers: ["one"] } },
      { type: "cloze", payload: { text: "___", answers: [" "] } },
      table([["1"]], cell),
      table(rows, []),
      table(rows, [{ row: 1, column: 0 }]),
      table([["", "France"]], cell),
      table(rows, [...cell, ...cell]),
    ]) {
      expect(parseContent([broken]), JSON.stringify(broken)).toBeNull();
    }
    // Control: each whole.
    expect(parseContent([cloze])).not.toBeNull();
    expect(parseContent([table(rows, cell)])).not.toBeNull();
  });

  it("read as their filled text, or as a screen reader reads them, and a cloze or a table makes a whole card where text does not", () => {
    const blocks =
      parseContent([{ type: "text", payload: { text: "Capitals" } }, table(rows, cell)]) ?? [];
    const sentence = parseContent([cloze]) ?? [];

    expect(describeContent(sentence)).toBe("Paris is in France");
    expect(describeContent(blocks)).toBe("Capitals Capital | Country\nParis | France");
    expect(spokenContent(sentence, false)).toBe("빈칸 is in 빈칸");
    expect(spokenContent(blocks, false)).toBe("Capitals. Capital, Country. 빈칸, France");
    expect(spokenContent(blocks, true)).toBe("Capitals. Capital, Country. Paris, France");
    expect(isWhole(sentence)).toBe(true);
    // Control: text alone, a v6 cloze's "___" included, is split.
    expect(isWhole([{ kind: "text", text: "___ is in France" }])).toBe(false);
  });
});

// The cases of the app's senses tests in `content_test.dart`.
describe("a card side's plain text", () => {
  it("gives each block's text on lines of its own, as the phone's plainText, leaving out an unknown block", () => {
    const side = parseContent([
      { type: "text", payload: { text: "first" } },
      cloze,
      table(rows, cell),
      { type: "senses", payload: { senses: [{ labels: [], meaning: "뜻", examples: [] }] } },
      { type: "later", payload: {} },
      {
        type: "image",
        payload: {
          media: "photo",
          width: 1,
          height: 1,
          boxes: [
            { id: "a", x: 0, y: 0, w: 1, h: 1, answer: "답" },
            { id: "b", x: 0, y: 0, w: 1, h: 1 },
          ],
        },
      },
      { type: "audio", payload: { media: "sound", duration_ms: 1 } },
    ]);
    if (!side) throw new Error("expected the side to parse");
    expect(plainText(side).split("\n")).toEqual([
      "first",
      "Paris is in France",
      "Capital | Country",
      "Paris | France",
      "뜻",
      "photo",
      "답",
      "sound",
    ]);
  });
});

describe("a senses block", () => {
  const sense = (fields: Record<string, unknown> = {}) => ({
    labels: [],
    meaning: "사과",
    examples: [],
    ...fields,
  });
  const senses = (value: unknown) => [{ type: "senses", payload: { senses: value } }];

  it("is read with each sense's labels, meaning and examples", () => {
    expect(
      parseContent(
        senses([
          sense({
            labels: [
              { kind: "part_of_speech", category: "noun", text: "명" },
              { kind: "other", category: null, text: "사물" },
            ],
            meaning: "기차",
            examples: ["기차를 타다"],
          }),
        ]),
      ),
    ).toEqual([
      {
        kind: "senses",
        senses: [
          {
            labels: [
              { kind: "part_of_speech", category: "noun", text: "명" },
              { kind: "other", category: null, text: "사물" },
            ],
            meaning: "기차",
            examples: ["기차를 타다"],
          },
        ],
      },
    ]);
  });

  it("is refused when it breaks its shape, where a whole one is read", () => {
    for (const broken of [
      senses([]),
      senses("사과"),
      senses([sense({ meaning: " " })]),
      senses([sense({ meaning: null })]),
      senses([sense({ examples: [1] })]),
      senses([sense({ labels: [{ kind: "part_of_speech", category: "gerund", text: "동" }] })]),
      senses([sense({ labels: [{ kind: "other", category: "noun", text: "사물" }] })]),
      senses([sense({ labels: [{ kind: "other", category: null, text: "" }] })]),
      senses([{ pos: "[명]", meaning: "사과" }]),
    ]) {
      expect(parseContent(broken), JSON.stringify(broken)).toBeNull();
    }
    // Control: a whole one, with a label of each kind.
    expect(
      parseContent(
        senses([
          sense({
            labels: [
              { kind: "part_of_speech", category: "noun", text: "명" },
              { kind: "other", category: null, text: "사물" },
            ],
          }),
        ]),
      ),
    ).not.toBeNull();
  });

  it("reads the back the server's senses migration writes, as supabase/tests/senses_migration_test.sql states it", () => {
    const migrated =
      '[{"type": "senses", "payload": {"senses": [{"labels": [{"kind": "part_of_speech", "text": "명", "category": "noun"}], "meaning": "사과", "examples": []}, {"labels": [{"kind": "part_of_speech", "text": "동", "category": "verb"}], "meaning": "먹다", "examples": []}]}}]';
    const blocks = parseContent(JSON.parse(migrated));
    expect(blocks).toEqual([
      {
        kind: "senses",
        senses: [
          {
            labels: [{ kind: "part_of_speech", category: "noun", text: "명" }],
            meaning: "사과",
            examples: [],
          },
          {
            labels: [{ kind: "part_of_speech", category: "verb", text: "동" }],
            meaning: "먹다",
            examples: [],
          },
        ],
      },
    ]);
    expect(describeContent(blocks ?? [])).toBe("[명] 사과\n[동] 먹다");
  });

  it("reads as one line per sense, each label in brackets and a space before the meaning, a part of speech by its short form", () => {
    const blocks =
      parseContent(
        senses([
          sense({
            labels: [{ kind: "part_of_speech", category: "verb", text: "v." }],
            meaning: "살다, 거주하다",
          }),
          sense({
            labels: [{ kind: "other", category: null, text: "사물" }],
            meaning: "철도 위를 다니는 긴 차",
          }),
          sense({ meaning: "사과" }),
        ]),
      ) ?? [];
    expect(describeContent(blocks)).toBe(
      "[동] 살다, 거주하다\n[사물] 철도 위를 다니는 긴 차\n사과",
    );
  });
});

// ADR 0106's block versions, as the app's `content_test.dart` states them.
describe("a block's version and id", () => {
  const known = [
    { type: "text", payload: { text: "bonjour" } },
    cloze,
    table(rows, cell),
    {
      type: "senses",
      payload: { senses: [{ labels: [], meaning: "기차", examples: [] }] },
    },
    { type: "image", payload: { media: "m1", width: 4, height: 3, boxes: [] } },
    { type: "audio", payload: { media: "m2", duration_ms: 1250 } },
  ];

  it("reads each known type at v1 with or without the field, and with an id", () => {
    for (const block of known) {
      const read = parseContent([block]);
      expect(read, block.type).not.toBeNull();
      expect(parseContent([{ ...block, v: 1 }]), block.type).toEqual(read);
      expect(parseContent([{ ...block, v: 1, id: "b1" }]), block.type).toEqual(read);
    }
  });

  it("shows a known type above the version it reads, or an unknown type, as a placeholder", () => {
    for (const block of known) {
      const above = block.type === "table" ? 3 : 2;
      expect(parseContent([{ ...block, v: above }]), block.type).toEqual([
        { kind: "unsupported", type: block.type },
      ]);
    }
    expect(parseContent([{ type: "video", v: 1, payload: { media: "m1" } }])).toEqual([
      { kind: "unsupported", type: "video" },
    ]);
  });

  it("refuses a v that is not a positive integer, or an id that is not text", () => {
    const text = { type: "text", payload: { text: "cat" } };
    for (const broken of [
      { ...text, v: 0 },
      { ...text, v: "1" },
      { ...text, v: 1.5 },
      { ...text, v: 1, id: 7 },
    ]) {
      expect(parseContent([broken]), JSON.stringify(broken)).toBeNull();
    }
    expect(parseContent([{ ...text, v: 1, id: "a" }]), "control").not.toBeNull();
  });

  it("upgrades an older payload one step per version", () => {
    const steps = {
      text: [
        (payload: unknown) => ({ body: (payload as { text: string }).text }),
        (payload: unknown) => ({ body: (payload as { body: string }).body.trim() }),
      ],
      cloze: [],
      table: [],
      senses: [],
      image: [],
      audio: [],
    };
    expect(blockVersion("text", steps)).toBe(3);
    expect(upcastPayload("text", 1, { text: " cat " }, steps)).toEqual({ body: "cat" });
    expect(upcastPayload("text", 2, { body: " cat " }, steps)).toEqual({ body: "cat" });
    expect(upcastPayload("text", 3, { body: "cat" }, steps)).toEqual({ body: "cat" });
    // Today a table and a cloze are read at v2, after one step, and every other type at v1, with none.
    expect(blockVersion("table")).toBe(2);
    expect(blockVersion("cloze")).toBe(2);
    for (const type of ["text", "senses", "image", "audio"] as const) {
      expect(blockVersion(type), type).toBe(1);
    }
  });
});

// The cases of the app's image tests in `content_test.dart` (ADR 0109).
describe("an image block", () => {
  const image = (payload: Record<string, unknown>) => ({ type: "image", payload });
  const box = (fields: Record<string, unknown>) =>
    image({ media: "m1", width: 4, height: 3, boxes: [fields] });
  const whole = { id: "1", x: 0.1, y: 0.2, w: 0.3, h: 0.4 };

  it("reads its photo, size and boxes in fractions of the image, keeping fields it does not know", () => {
    expect(
      parseContent([
        image({
          media: "m1",
          width: 1200,
          height: 800,
          boxes: [
            { ...whole, answer: "Paris", shape: "oval" },
            { id: "2", x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
          ],
          crop: { x: 0 },
        }),
      ]),
    ).toEqual([
      {
        kind: "image",
        media: "m1",
        width: 1200,
        height: 800,
        boxes: [
          { ...whole, answer: "Paris", rest: { shape: "oval" } },
          { id: "2", x: 0.5, y: 0.5, w: 0.5, h: 0.5, answer: null },
        ],
        rest: { crop: { x: 0 } },
      },
    ]);
  });

  it("is refused when it breaks its shape, where a whole one is read", () => {
    for (const broken of [
      image({ width: 4, height: 3, boxes: [] }),
      image({ media: "", width: 4, height: 3, boxes: [] }),
      image({ media: "m1", width: 0, height: 3, boxes: [] }),
      image({ media: "m1", width: 4.5, height: 3, boxes: [] }),
      image({ media: "m1", width: 4, height: 3 }),
      box({ x: 0, y: 0, w: 1, h: 1 }),
      box({ ...whole, x: -0.1 }),
      box({ ...whole, w: 0 }),
      box({ ...whole, x: 0.6, w: 0.5 }),
      box({ ...whole, y: 0.6, h: 0.5 }),
      box({ ...whole, answer: 3 }),
      image({ media: "m1", width: 4, height: 3, boxes: [whole, whole] }),
    ]) {
      expect(parseContent([broken]), JSON.stringify(broken)).toBeNull();
    }
    // Control: each whole.
    expect(parseContent([box(whole)])).not.toBeNull();
    expect(parseContent([image({ media: "m1", width: 4, height: 3, boxes: [] })])).not.toBeNull();
  });

  it("reads as a photo with each box a blank until revealed, and makes a whole card only with a box", () => {
    const boxed = parseContent([box({ ...whole, answer: "Paris" })]) ?? [];
    const bare = parseContent([image({ media: "m1", width: 4, height: 3, boxes: [] })]) ?? [];

    expect(describeContent(boxed)).toBe("사진");
    expect(spokenContent(boxed, false)).toBe("사진, 빈칸");
    expect(spokenContent(boxed, true)).toBe("사진, Paris");
    expect(isWhole(boxed)).toBe(true);
    // Control: the same photo without a box is split.
    expect(isWhole(bare)).toBe(false);
  });
});

// The cases of the app's audio tests in `content_test.dart` (ADR 0112).
describe("an audio block", () => {
  const audio = (payload: Record<string, unknown>) => ({ type: "audio", payload });

  it("reads its media id and length in milliseconds, keeping fields it does not know", () => {
    expect(parseContent([audio({ media: "m1", duration_ms: 2400, waveform: [1, 2] })])).toEqual([
      { kind: "audio", media: "m1", durationMs: 2400, rest: { waveform: [1, 2] } },
    ]);
  });

  it("is refused when it breaks its shape, where a whole one is read", () => {
    for (const broken of [
      audio({ duration_ms: 1000 }),
      audio({ media: "", duration_ms: 1000 }),
      audio({ media: "m1" }),
      audio({ media: "m1", duration_ms: 0 }),
      audio({ media: "m1", duration_ms: -5 }),
      audio({ media: "m1", duration_ms: 1.5 }),
      audio({ media: "m1", duration_ms: "1000" }),
      audio({ url: "https://example.com/cat.m4a", duration_ms: 1000 }),
    ]) {
      expect(parseContent([broken]), JSON.stringify(broken)).toBeNull();
    }
    // Control: a whole one.
    expect(parseContent([audio({ media: "m1", duration_ms: 1 })])).not.toBeNull();
  });

  it("reads as 소리, makes no whole card, and is found among a side's blocks with its length rounded up", () => {
    const side =
      parseContent([
        { type: "text", payload: { text: "cat" } },
        audio({ media: "m1", duration_ms: 1250 }),
      ]) ?? [];

    expect(describeContent(side)).toBe("cat 소리");
    expect(spokenContent(side, false)).toBe("cat. 소리");
    expect(isWhole(side)).toBe(false);
    expect(audioOf(side)).toEqual([{ kind: "audio", media: "m1", durationMs: 1250 }]);
    expect(audioLength(1250)).toBe("0:02");
    expect(audioLength(60000)).toBe("1:00");
  });
});

// The cases of the app's span tests in `content_test.dart` (ADR 0110).
describe("a table's spans", () => {
  const text = "5부족 연맹체, 왕 아래 마가·우가";
  const spanTable = (
    fields: { v?: number; blanks?: unknown; spans?: unknown } = {},
    withSpans = true,
  ) => ({
    type: "table",
    ...(fields.v === undefined ? {} : { v: fields.v }),
    payload: {
      columns: ["", "정치"],
      rows: [
        ["부여", text],
        ["고구려", "5부"],
      ],
      blanks: fields.blanks ?? [],
      ...(withSpans ? { spans: fields.spans ?? [] } : {}),
    },
  });
  const span = (row: number, column: number, start: number, end: number) => ({
    row,
    column,
    start,
    end,
  });
  const whole = [{ row: 1, column: 1 }];

  it("upcasts a v1 table, with or without its v, to v2 with its blanks whole cells and no span", () => {
    for (const stored of [
      spanTable({ blanks: whole }, false),
      spanTable({ v: 1, blanks: whole }, false),
    ]) {
      expect(parseContent([stored]), JSON.stringify(stored)).toEqual([
        expect.objectContaining({ kind: "table", blanks: whole, spans: [] }),
      ]);
    }
  });

  it("reads a v2 table's spans beside whole-cell blanks, several in one cell", () => {
    const spans = [span(0, 1, 0, 7), span(0, 1, 14, 16)];
    expect(parseContent([spanTable({ v: 2, blanks: whole, spans })])).toEqual([
      {
        kind: "table",
        columns: ["", "정치"],
        rows: [
          ["부여", text],
          ["고구려", "5부"],
        ],
        blanks: whole,
        spans,
      },
    ]);
  });

  it("refuses a span outside its cell, empty, of whitespace, overlapping another or in a whole-cell blank, and a table of no blank at all, where a whole one is read", () => {
    for (const broken of [
      spanTable({ v: 2, spans: [span(0, 1, 0, text.length + 1)] }),
      spanTable({ v: 2, spans: [span(0, 2, 0, 1)] }),
      spanTable({ v: 2, spans: [span(2, 1, 0, 1)] }),
      spanTable({ v: 2, spans: [span(0, -1, 0, 1)] }),
      spanTable({ v: 2, spans: [span(0, 1, -1, 3)] }),
      spanTable({ v: 2, spans: [span(0, 1, 3, 3)] }),
      spanTable({ v: 2, spans: [span(0, 1, 8, 9)] }),
      spanTable({ v: 2, spans: [span(0, 1, 0, 7), span(0, 1, 6, 9)] }),
      spanTable({ v: 2, spans: [span(0, 1, 0, 7), span(0, 1, 0, 7)] }),
      spanTable({ v: 2, blanks: [{ row: 0, column: 1 }], spans: [span(0, 1, 0, 7)] }),
      spanTable({ v: 2, spans: [span(0, 1, 0, 7), "not a span"] }),
      spanTable({ v: 2 }),
      spanTable({ v: 2, blanks: [{ row: 0, column: 1 }] }, false),
    ]) {
      expect(parseContent([broken]), JSON.stringify(broken)).toBeNull();
    }
    // Control: spans alone, two touching in one cell.
    expect(
      parseContent([spanTable({ v: 2, spans: [span(0, 1, 0, 7), span(0, 1, 7, 9)] })]),
    ).not.toBeNull();
  });

  it("speaks each span as 빈칸 inside its cell's text until revealed, and describes every cell whole", () => {
    const blocks =
      parseContent([
        spanTable({ v: 2, blanks: whole, spans: [span(0, 1, 14, 16), span(0, 1, 0, 7)] }),
      ]) ?? [];
    expect(spokenContent(blocks, false)).toBe(
      ", 정치. 부여, 빈칸, 왕 아래 빈칸·우가. 고구려, 빈칸",
    );
    expect(spokenContent(blocks, true)).toBe(`, 정치. 부여, ${text}. 고구려, 5부`);
    expect(describeContent(blocks)).toBe(` | 정치\n부여 | ${text}\n고구려 | 5부`);
  });
});
