import assert from "node:assert/strict";
import {
  CARD_RULES,
  type CardRule,
  cardsSchema,
  closeCutReply,
  composeAnswer,
  composeClozeAnswer,
  composeInstructions,
  composeTableAnswer,
  KINDS,
  LABEL_KINDS,
  MAX_ANSWER_CHARS,
  MAX_CARDS,
  MAX_CLOZE_BLANKS,
  MAX_EXAMPLES,
  MAX_EXTRAS,
  MAX_FIELD_CHARS,
  MAX_SENSE_LABELS,
  MAX_SENSES,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  MAX_TOPIC_CHARS,
  OUTPUT_CONTRACT,
  parseCard,
  parseCards,
  parseReply,
  PARTS_OF_SPEECH,
  Refusal,
  TYPES,
} from "./cards.ts";
import { SYSTEM_PROMPT as V9 } from "./prompt_v9.ts";

const reply = (cards: unknown) => JSON.stringify({ cards });

/** A model's sense of [meaning] with [labels] and no examples. */
const sense = (meaning: string, labels: unknown[] = []) => ({
  labels,
  meaning,
  examples: [],
});
const VERB = { kind: "part_of_speech", category: "verb", text: "동" };
const NOUN = { kind: "part_of_speech", category: "noun", text: "명" };
const CLASS = { kind: "other", category: null, text: "사물" };

/** A model's vocabulary card of one sense with no part of speech, overridden by `fields`. */
const item = (fields: Record<string, unknown> = {}) => ({
  kind: "vocabulary",
  type: "concept",
  front: "apple",
  answer: null,
  topic: "과일",
  senses: [sense("사과")],
  extras: [],
  pronunciation: null,
  examples: [],
  table: null,
  cloze: null,
  ...fields,
});

/** A model's note card, overridden by `fields`. */
const note = (fields: Record<string, unknown> = {}) =>
  item({
    kind: "note",
    front: "연역 논증과 귀납 논증의 차이",
    answer:
      "연역은 전제가 참이면 결론이 반드시 참이고, 귀납은 결론이 개연적으로만 참이다.",
    topic: "연역과 귀납",
    senses: [],
    ...fields,
  });

/** Two rows of a classification table, each row's two cells blanks, as the model writes them. */
const TABLE = {
  columns: ["구분", "높임", "낮춤"],
  rows: [["1인칭", "저, 저희", "나, 우리"], [
    "2인칭",
    "당신, 그대",
    "너, 너희",
  ]],
  blanks: [
    { row: 0, column: 1 },
    { row: 0, column: 2 },
    { row: 1, column: 1 },
    { row: 1, column: 2 },
  ],
};

/** A cloze card's two answers, as the model writes them. */
const CLOZE = { answers: ["자기, 자신", "저, 저희"] };

/** A model's table card of `TABLE`. */
const table = (fields: Record<string, unknown> = {}) =>
  note({
    type: "table",
    front: "인칭 대명사",
    answer: null,
    topic: "대명사",
    table: TABLE,
    ...fields,
  });

/** A model's cloze card of two blanks. */
const cloze = (fields: Record<string, unknown> = {}) =>
  note({
    type: "cloze",
    front:
      "3인칭 재귀칭: 높임 당신 · 예사 {{c1::자기, 자신}} · 낮춤 {{c2::저, 저희}}",
    answer: null,
    topic: "대명사",
    cloze: CLOZE,
    ...fields,
  });

const one = (cards: unknown[]) => parseCards(reply(cards))?.[0];

/** [base]'s table with [fields] in place of its own. */
const tableWith = (fields: Record<string, unknown>) =>
  table({ table: { ...TABLE, ...fields } });

Deno.test("parseCards returns a vocabulary card of one sense with its fields trimmed and its meaning as the answer", () => {
  assert.deepEqual(
    one([item({
      front: "  run ",
      senses: [{
        labels: [{ ...VERB, text: " 동 " }, CLASS],
        meaning: "\n달리다, 운영하다\t",
        examples: [" I run fast. "],
      }],
      extras: [{ label: " 유의어 ", text: " sprint " }],
      pronunciation: " [rʌn] ",
      examples: [" I run every morning. ", "run a shop"],
    })]),
    {
      kind: "vocabulary",
      type: "concept",
      front: "run",
      answer: "달리다, 운영하다",
      topic: "과일",
      examples: ["I run every morning.", "run a shop"],
      senses: [{
        labels: [VERB, CLASS],
        meaning: "달리다, 운영하다",
        examples: ["I run fast."],
      }],
      extras: [{ label: "유의어", text: "sprint" }],
      pronunciation: "[rʌn]",
    },
  );
});

Deno.test("several senses keep their order and labels, and compose an answer of one line per sense, its labels before its meaning", () => {
  const card = one([item({
    front: "face",
    senses: [
      sense("직면하다, 마주하다", [VERB]),
      sense("표면, 겉면", [NOUN]),
      sense("얼굴, 생김새", [NOUN]),
    ],
  })]);
  assert.ok(card?.kind === "vocabulary");
  assert.deepEqual(card.senses.map((sense) => sense.labels), [
    [VERB],
    [NOUN],
    [NOUN],
  ]);
  const lines = "[동] 직면하다, 마주하다\n[명] 표면, 겉면\n[명] 얼굴, 생김새";
  assert.equal(card.answer, lines, "not '[동] [명] [명] 직면하다, …'");
  // A sense without a label is its meaning alone on its line.
  assert.deepEqual(
    composeAnswer([
      { labels: [], meaning: "a", examples: [] },
      {
        labels: [{ kind: "part_of_speech", category: "noun", text: "n." }],
        meaning: "b",
        examples: [],
      },
    ]),
    "a\n[n.] b",
  );
});

Deno.test("a note card returns its concept, answer and topic, and no senses", () => {
  const card = one([note({ examples: ["253+4637+647898=652788 -> 연역"] })]);
  assert.deepEqual(card, {
    kind: "note",
    type: "concept",
    front: "연역 논증과 귀납 논증의 차이",
    answer:
      "연역은 전제가 참이면 결론이 반드시 참이고, 귀납은 결론이 개연적으로만 참이다.",
    topic: "연역과 귀납",
    examples: ["253+4637+647898=652788 -> 연역"],
  });
});

Deno.test("a vocabulary card without extras, pronunciation or examples leaves those keys absent, and its answer is the meaning", () => {
  const card = one([item()]);
  assert.equal(card?.answer, "사과");
  for (const key of ["extras", "pronunciation", "examples"]) {
    assert.ok(card !== undefined && !Object.hasOwn(card, key), `no ${key} key`);
  }
  const control = one([item({ pronunciation: "[ˈæpl]" })]);
  assert.ok(control?.kind === "vocabulary");
  assert.equal(
    control.pronunciation,
    "[ˈæpl]",
    "control: a printed one is kept",
  );
});

Deno.test("a sense's labels keep the page's order, a part of speech with its category and any other label with none, and a sense may have none", () => {
  const card = one([item({
    front: "기차",
    senses: [
      sense("철도 위를 다니는 긴 차", [
        { kind: "part_of_speech", category: "noun", text: "명사" },
        CLASS,
      ]),
      sense("기차를 타다"),
    ],
  })]);
  assert.ok(card?.kind === "vocabulary");
  assert.deepEqual(card.senses, [
    {
      labels: [
        { kind: "part_of_speech", category: "noun", text: "명사" },
        { kind: "other", category: null, text: "사물" },
      ],
      meaning: "철도 위를 다니는 긴 차",
      examples: [],
    },
    { labels: [], meaning: "기차를 타다", examples: [] },
  ]);
});

Deno.test("parseCards refuses a sense whose label is not a part of speech on the list or another label without a category", () => {
  const refused: Record<string, unknown> = {
    "an unknown kind": { kind: "gender", category: null, text: "m." },
    "a part of speech without a category": { ...VERB, category: null },
    "a part of speech off the list": { ...VERB, category: "gerund" },
    "a category given as other": { ...VERB, category: "other" },
    "another label with a category": { ...CLASS, category: "noun" },
    "a label without text": { kind: "other", category: null },
    "a label with a key outside the shape": { ...CLASS, printed: "[사물]" },
    "a label that is text": "[동]",
  };
  for (const [name, label] of Object.entries(refused)) {
    assert.equal(
      parseCards(reply([item({ senses: [sense("뜻", [label])] })])),
      null,
      name,
    );
  }
  for (const category of PARTS_OF_SPEECH) {
    assert.equal(
      parseCards(
        reply([
          item({ senses: [sense("뜻", [{ ...VERB, category }, CLASS])] }),
        ]),
      )
        ?.length,
      1,
      `control: ${category} and another label are read`,
    );
  }
});

Deno.test("a label written with its brackets keeps only what they enclose, and one without keeps its dots", () => {
  const texts = (printed: string[]) => {
    const card = one([item({
      senses: [sense("뜻", printed.map((text) => ({ ...CLASS, text })))],
    })]);
    assert.ok(card?.kind === "vocabulary");
    return card.senses[0].labels.map((label) => label.text);
  };
  assert.deepEqual(texts(["[동]", "(명)", "「명사」", "〔사물〕"]), [
    "동",
    "명",
    "명사",
    "사물",
  ]);
  assert.deepEqual(texts(["n.", "동", "[a] b", "(x"]), [
    "n.",
    "동",
    "[a] b",
    "(x",
  ], "control: a label not enclosed is kept as written");
});

Deno.test("no card carries a field kept only for an older app: short, step, meaning, partOfSpeech or back", () => {
  const cards = [
    item({ senses: [sense("사과", [NOUN])] }),
    note(),
  ].map((card) => one([card]));
  for (const card of cards) {
    for (const key of ["short", "step", "meaning", "partOfSpeech", "back"]) {
      assert.ok(
        card !== undefined && !Object.hasOwn(card, key),
        `no ${key} key`,
      );
    }
    // Control: the same cards carry the fields an app reads today.
    assert.ok(
      card !== undefined && Object.hasOwn(card, "answer") &&
        Object.hasOwn(card, "topic"),
    );
  }
  for (const extra of [{ short: "사과" }, { step: 1 }]) {
    assert.equal(
      parseCards(reply([item(extra)])),
      null,
      `prompt v4's ${Object.keys(extra)[0]} is not a key of the schema`,
    );
  }
});

Deno.test("parseCards takes each kind and refuses any other", () => {
  assert.equal(one([item()])?.kind, "vocabulary");
  assert.equal(one([note()])?.kind, "note");
  assert.deepEqual([...KINDS], ["vocabulary", "note"]);
  for (const kind of ["notes", "Vocabulary", null]) {
    assert.equal(parseCards(reply([item({ kind })])), null, String(kind));
  }
});

Deno.test("parseCards takes each type, concept, cloze, identify or table, and refuses any other or none", () => {
  assert.deepEqual([...TYPES], ["concept", "cloze", "identify", "table"]);
  for (const type of ["concept", "identify"]) {
    assert.equal(one([note({ type })])?.type, type);
  }
  assert.equal(one([cloze()])?.type, "cloze");
  assert.equal(one([table()])?.type, "table");
  for (const type of ["Concept", "judgment", "", null]) {
    assert.equal(parseCards(reply([note({ type })])), null, String(type));
  }
  const { type: _, ...untyped } = note();
  assert.equal(parseCards(reply([untyped])), null, "a card without a type");
});

Deno.test("a vocabulary card has senses and no answer, and a note an answer and no senses, extras or pronunciation", () => {
  assert.equal(parseCards(reply([item({ senses: [] })])), null, "no sense");
  assert.equal(
    parseCards(reply([item({ answer: "사과" })])),
    null,
    "an answer",
  );
  assert.equal(
    parseCards(reply([note({ answer: null })])),
    null,
    "no answer",
  );
  for (
    const fields of [
      { senses: [sense("뜻")] },
      { extras: [{ label: "유의어", text: "x" }] },
      { pronunciation: "[x]" },
    ]
  ) {
    assert.equal(
      parseCards(reply([note(fields)])),
      null,
      JSON.stringify(fields),
    );
  }
  assert.equal(
    parseCards(reply([item(), note()]))?.length,
    2,
    "control: each as its kind fills it",
  );
});

Deno.test("parseCards refuses prompt v5's vocabulary card, with its answer and part of speech and no senses", () => {
  assert.equal(
    parseCards(reply([{
      kind: "vocabulary",
      type: "concept",
      front: "apple",
      answer: "사과",
      topic: "과일",
      partOfSpeech: "n.",
      examples: [],
    }])),
    null,
  );
});

Deno.test("parseCards takes a topic trimmed, of 1 to 60 code points, and refuses any other", () => {
  const atLimit = "가".repeat(MAX_TOPIC_CHARS - 1) + "😀";
  assert.equal(one([note({ topic: "  3. 축약 " })])?.topic, "3. 축약");
  assert.equal(
    one([note({ topic: atLimit })])?.topic,
    atLimit,
    "control: a topic of 60 code points",
  );
  for (const topic of [atLimit + "a", " ", "", 1, null]) {
    assert.equal(
      parseCards(reply([note({ topic })])),
      null,
      JSON.stringify(topic),
    );
  }
});

Deno.test("parseCards accepts an empty list, which the handler reports as no cards", () => {
  assert.deepEqual(parseCards(reply([])), []);
});

Deno.test("parseCards refuses a reply that is not JSON", () => {
  assert.equal(parseCards('{"cards": ['), null);
  assert.equal(parseCards("```json\n" + reply([]) + "\n```"), null);
  assert.deepEqual(
    parseCards(reply([])),
    [],
    "control: the same list as bare JSON",
  );
});

Deno.test("parseCards refuses keys and types the schema does not allow", () => {
  assert.equal(parseCards(reply([item()]))?.length, 1, "control: a valid card");
  assert.equal(
    parseCards(JSON.stringify({ cards: [item()], note: "x" })),
    null,
  );
  for (const key of ["hint", "back", "meaning", "partOfSpeech"]) {
    assert.equal(parseCards(reply([item({ [key]: "x" })])), null, key);
  }
  // Prompt v2's shape, without kind, answer, short or step.
  assert.equal(
    parseCards(reply([{
      front: "apple",
      meaning: "사과",
      partOfSpeech: null,
      examples: [],
    }])),
    null,
  );
  const complete: Record<string, unknown> = item();
  for (const key of Object.keys(complete)) {
    const { [key]: _, ...missing } = complete;
    assert.equal(parseCards(reply([missing])), null, `without ${key}`);
  }
  for (
    const fields of [
      { front: 1 },
      { senses: "a" },
      { senses: [{ labels: [], examples: [] }] },
      { senses: [{ labels: [], meaning: "뜻" }] },
      { senses: [{ meaning: "뜻", examples: [] }] },
      { senses: [{ ...sense("뜻"), note: "x" }] },
      { senses: [{ ...sense("뜻"), examples: [1] }] },
      { senses: [{ pos: null, meaning: "뜻" }] },
      { extras: [{ label: "유의어" }] },
      { extras: [{ label: "유의어", text: "x", more: "y" }] },
      { pronunciation: 1 },
      { examples: "a" },
      { examples: [1] },
    ]
  ) {
    assert.equal(
      parseCards(reply([item(fields)])),
      null,
      JSON.stringify(fields),
    );
  }
  assert.equal(parseCards(reply("a")), null);
  assert.equal(parseCards(reply([["a", "b"]])), null);
  assert.equal(parseCards("[]"), null);
});

Deno.test("parseCards refuses a field that is empty once trimmed", () => {
  for (
    const card of [
      item({ front: "  " }),
      note({ answer: "" }),
      item({ senses: [sense("사과", [{ ...VERB, text: " " }])] }),
      item({ senses: [sense("사과", [{ ...VERB, text: "[ ]" }])] }),
      item({ senses: [sense(" ")] }),
      item({ senses: [{ ...sense("사과"), examples: [" "] }] }),
      item({ extras: [{ label: " ", text: "x" }] }),
      item({ extras: [{ label: "유의어", text: "" }] }),
      item({ pronunciation: " " }),
      item({ examples: ["ok", " "] }),
    ]
  ) {
    assert.equal(parseCards(reply([card])), null, JSON.stringify(card));
  }
  assert.equal(
    one([item({ front: " a ", examples: [" b "] })])?.front,
    "a",
    "control: fields with text inside the whitespace",
  );
});

Deno.test("parseCards refuses a field over its limit in code points, counting each emoji once", () => {
  const upTo = (n: number) => "가".repeat(n - 1) + "😀";
  const atLimit = upTo(MAX_FIELD_CHARS);
  assert.equal([...atLimit].length, 500);
  assert.equal(
    atLimit.length,
    501,
    "the field is longer than 500 UTF-16 units",
  );
  const fields = (text: string) => [
    { front: text },
    { senses: [sense("뜻", [{ ...CLASS, text }])] },
    { senses: [sense(text)] },
    { senses: [{ ...sense("뜻"), examples: [text] }] },
    { extras: [{ label: text, text: "x" }] },
    { extras: [{ label: "유의어", text }] },
    { pronunciation: text },
    { examples: [text] },
  ];
  for (const field of fields(atLimit)) {
    assert.equal(
      parseCards(reply([item(field)]))?.length,
      1,
      `${JSON.stringify(field).slice(0, 30)} at the limit`,
    );
  }
  for (const field of fields(atLimit + "a")) {
    assert.equal(
      parseCards(reply([item(field)])),
      null,
      `${JSON.stringify(field).slice(0, 30)} over the limit`,
    );
  }
  const long = upTo(MAX_ANSWER_CHARS);
  assert.equal(
    parseCards(reply([note({ answer: long })]))?.length,
    1,
    "an answer of 1000",
  );
  assert.equal(
    parseCards(reply([note({ answer: long + "a" })])),
    null,
    "an answer over 1000",
  );
});

Deno.test("parseCards refuses more than 5 examples, 10 senses or 10 extras on a card", () => {
  const many = <T>(n: number, make: (i: number) => T) =>
    Array.from({ length: n }, (_, i) => make(i));
  const example = (i: number) => `e${i}`;
  const numbered = (i: number) => sense(`뜻${i}`);
  const label = (i: number) => ({ ...CLASS, text: `분류${i}` });
  const extra = (i: number) => ({ label: "유의어", text: `x${i}` });
  assert.deepEqual(
    one([item({ examples: many(MAX_EXAMPLES, example) })])?.examples,
    many(5, example),
  );
  assert.equal(
    parseCards(reply([item({ examples: many(MAX_EXAMPLES + 1, example) })])),
    null,
  );
  assert.equal(
    parseCards(reply([item({ senses: many(MAX_SENSES, numbered) })]))?.length,
    1,
  );
  assert.equal(
    parseCards(reply([item({ senses: many(MAX_SENSES + 1, numbered) })])),
    null,
  );
  assert.equal(
    one([item({ senses: [sense("뜻", many(MAX_SENSE_LABELS, label))] })])
      ?.kind,
    "vocabulary",
  );
  assert.equal(
    parseCards(
      reply([
        item({ senses: [sense("뜻", many(MAX_SENSE_LABELS + 1, label))] }),
      ]),
    ),
    null,
  );
  assert.equal(
    one([item({ senses: [{ ...sense("뜻"), examples: many(5, example) }] })])
      ?.kind,
    "vocabulary",
  );
  assert.equal(
    parseCards(
      reply([
        item({ senses: [{ ...sense("뜻"), examples: many(6, example) }] }),
      ]),
    ),
    null,
  );
  assert.equal(
    parseCards(reply([item({ extras: many(MAX_EXTRAS, extra) })]))?.length,
    1,
  );
  assert.equal(
    parseCards(reply([item({ extras: many(MAX_EXTRAS + 1, extra) })])),
    null,
  );
});

Deno.test("parseCards refuses more than 100 cards", () => {
  const cards = (n: number) =>
    Array.from({ length: n }, (_, i) => item({ front: `w${i}` }));
  assert.equal(parseCards(reply(cards(MAX_CARDS)))?.length, 100);
  assert.equal(parseCards(reply(cards(MAX_CARDS + 1))), null);
});

Deno.test("a table card returns its table as the page prints it, and its answer is the table as plain text, one row per line, for an app that reads only front and back", () => {
  const card = one([table({ front: " 인칭 대명사 " })]);
  assert.deepEqual(card, {
    kind: "note",
    type: "table",
    front: "인칭 대명사",
    answer:
      "구분 | 높임 | 낮춤\n1인칭 | 저, 저희 | 나, 우리\n2인칭 | 당신, 그대 | 너, 너희",
    topic: "대명사",
    table: TABLE,
  });
});

Deno.test("a table keeps a cell the page leaves empty as empty text, trims every cell, and a blank may sit in any column", () => {
  const card = one([tableWith({
    columns: ["", " 높임 "],
    rows: [["1인칭", ""], [" 2인칭 ", "당신"]],
    blanks: [{ row: 1, column: 1 }, { row: 0, column: 0 }],
  })]);
  assert.deepEqual(
    card?.kind === "note" && card.type === "table" && card.table,
    {
      columns: ["", "높임"],
      rows: [["1인칭", ""], ["2인칭", "당신"]],
      blanks: [{ row: 1, column: 1 }, { row: 0, column: 0 }],
    },
  );
  assert.equal(card?.answer, " | 높임\n1인칭 | \n2인칭 | 당신");
});

Deno.test("parseCards refuses a malformed table: ragged rows, a blank outside the table, on an empty cell or twice, no blank, and no column or row", () => {
  assert.equal(
    parseCards(reply([table()]))?.length,
    1,
    "control: the table as written",
  );
  const malformed: Record<string, Record<string, unknown>> = {
    "a short row": {
      rows: [["1인칭", "저, 저희"], ["2인칭", "당신, 그대", "너, 너희"]],
    },
    "a long row": {
      rows: [["1인칭", "저, 저희", "나, 우리", "x"], [
        "2인칭",
        "당신, 그대",
        "너, 너희",
      ]],
    },
    "a blank below the last row": { blanks: [{ row: 2, column: 1 }] },
    "a blank right of the last column": { blanks: [{ row: 0, column: 3 }] },
    "a negative blank": { blanks: [{ row: -1, column: 1 }] },
    "a fractional blank": { blanks: [{ row: 0.5, column: 1 }] },
    "a blank as text": { blanks: [{ row: "0", column: 1 }] },
    "a blank with another key": { blanks: [{ row: 0, column: 1, cell: "x" }] },
    "the same blank twice": {
      blanks: [{ row: 0, column: 1 }, { row: 0, column: 1 }],
    },
    "no blank": { blanks: [] },
    "no column": { columns: [], rows: [[], []], blanks: [] },
    "no row": { rows: [], blanks: [] },
    "a cell that is not text": {
      rows: [["1인칭", 1, "나"], ["2인칭", "당신", "너"]],
    },
  };
  for (const [name, fields] of Object.entries(malformed)) {
    assert.equal(parseCards(reply([tableWith(fields)])), null, name);
  }
  assert.equal(
    parseCards(reply([tableWith({
      rows: [["1인칭", " ", "나"], ["2인칭", "당신", "너"]],
      blanks: [{ row: 0, column: 1 }],
    })])),
    null,
    "a blank on a cell that is empty once trimmed",
  );
  assert.equal(
    parseCards(reply([table({ table: { ...TABLE, note: "x" } })])),
    null,
    "a key outside the table's",
  );
});

Deno.test("parseCards takes a table of up to 8 columns and 20 rows of cells up to 500 code points, and refuses a larger one", () => {
  const grid = (columns: number, rows: number, cellText = "x") =>
    tableWith({
      columns: Array.from({ length: columns }, (_, i) => `c${i}`),
      rows: Array.from(
        { length: rows },
        () => Array.from({ length: columns }, () => cellText),
      ),
      blanks: [{ row: 0, column: 0 }],
    });
  const atLimit = "가".repeat(MAX_FIELD_CHARS - 1) + "😀";
  assert.equal(
    parseCards(reply([grid(MAX_TABLE_COLUMNS, MAX_TABLE_ROWS, atLimit)]))
      ?.length,
    1,
    "control: the largest table",
  );
  assert.equal(parseCards(reply([grid(MAX_TABLE_COLUMNS + 1, 1)])), null);
  assert.equal(parseCards(reply([grid(1, MAX_TABLE_ROWS + 1)])), null);
  assert.equal(parseCards(reply([grid(1, 1, atLimit + "a")])), null);
});

Deno.test("a cloze card returns what fills each blank, and its answer is those answers one per line", () => {
  const card = one([
    cloze({ cloze: { answers: [" 자기, 자신 ", "저, 저희"] } }),
  ]);
  assert.deepEqual(card, {
    kind: "note",
    type: "cloze",
    front:
      "3인칭 재귀칭: 높임 당신 · 예사 {{c1::자기, 자신}} · 낮춤 {{c2::저, 저희}}",
    answer: "자기, 자신\n저, 저희",
    topic: "대명사",
    cloze: { answers: ["자기, 자신", "저, 저희"] },
  });
});

Deno.test("parseCards refuses a cloze whose answers do not match its front's blanks one for one, or that has none, too many or an empty one", () => {
  const blanks = (n: number) =>
    Array.from({ length: n }, (_, i) => `{{c${i + 1}::a${i}}}`).join(" ");
  const answers = (n: number) => Array.from({ length: n }, (_, i) => `a${i}`);
  assert.equal(
    parseCards(
      reply([cloze({ front: blanks(1), cloze: { answers: answers(1) } })]),
    )
      ?.length,
    1,
    "control: one blank and one answer",
  );
  assert.equal(
    parseCards(reply([cloze({
      front: blanks(MAX_CLOZE_BLANKS),
      cloze: { answers: answers(MAX_CLOZE_BLANKS) },
    })]))?.length,
    1,
    "control: 10 blanks and 10 answers",
  );
  const malformed: Record<string, Record<string, unknown>> = {
    "fewer answers than blanks": {
      front: blanks(2),
      cloze: { answers: answers(1) },
    },
    "more answers than blanks": {
      front: blanks(1),
      cloze: { answers: answers(2) },
    },
    "a front with no blank": {
      front: "3인칭 재귀칭",
      cloze: { answers: answers(1) },
    },
    "a blank written ___ as before": {
      front: "3인칭 재귀칭: ___",
      cloze: { answers: answers(1) },
    },
    "a span never closed": {
      front: "3인칭 재귀칭: {{c1::자기",
      cloze: { answers: answers(1) },
    },
    "a span with no answer": {
      front: "3인칭 재귀칭: {{c1::}}",
      cloze: { answers: answers(1) },
    },
    "no answer": { front: "3인칭 재귀칭", cloze: { answers: [] } },
    "11 blanks": {
      front: blanks(MAX_CLOZE_BLANKS + 1),
      cloze: { answers: answers(MAX_CLOZE_BLANKS + 1) },
    },
    "an empty answer": { front: blanks(1), cloze: { answers: [" "] } },
    "a key outside the cloze's": {
      front: blanks(1),
      cloze: { answers: answers(1), hint: "x" },
    },
  };
  for (const [name, fields] of Object.entries(malformed)) {
    assert.equal(parseCards(reply([cloze(fields)])), null, name);
  }
});

Deno.test("only a note's table card has a table and only its cloze card a cloze, neither with an answer, and a vocabulary card is neither", () => {
  assert.equal(
    parseCards(reply([table(), cloze(), note(), item()]))?.length,
    4,
    "control: each type as it fills its fields",
  );
  const refused: Record<string, unknown> = {
    "a table card without its table": table({ table: null }),
    "a table card with an answer": table({ answer: "x" }),
    "a table card with a cloze": table({ cloze: CLOZE }),
    "a cloze card without its cloze": cloze({ cloze: null }),
    "a cloze card with an answer": cloze({ answer: "x" }),
    "a cloze card with a table": cloze({ table: TABLE }),
    "a concept card with a table": note({ table: TABLE }),
    "a concept card with a cloze": note({ cloze: CLOZE }),
    "a vocabulary table card": table({
      kind: "vocabulary",
      senses: [sense("x")],
    }),
    "a vocabulary cloze card": cloze({
      kind: "vocabulary",
      senses: [sense("x")],
    }),
    "a vocabulary card with a table": item({ table: TABLE }),
    "a vocabulary card of type table": item({ type: "table" }),
    "a vocabulary card of type cloze": item({ type: "cloze" }),
  };
  for (const [name, card] of Object.entries(refused)) {
    assert.equal(parseCards(reply([card])), null, name);
  }
});

Deno.test("composeTableAnswer writes the column headers, then one line per row, cells joined by a bar; composeClozeAnswer one line per answer", () => {
  assert.equal(
    composeTableAnswer({
      columns: ["a", "b"],
      rows: [["1", "2"]],
      blanks: [{ row: 0, column: 1 }],
    }),
    "a | b\n1 | 2",
  );
  assert.equal(composeClozeAnswer({ answers: ["x"] }), "x");
  assert.equal(composeClozeAnswer({ answers: ["x", "y, z"] }), "x\ny, z");
});

Deno.test("the schema sent to the model states the fields and the limits the parser enforces", () => {
  const cards = cardsSchema.properties.cards;
  const fields = cards.items.properties;
  assert.equal(cards.maxItems, MAX_CARDS);
  for (
    const field of [
      fields.front,
      fields.pronunciation,
      fields.senses.items.properties.meaning,
    ]
  ) {
    assert.equal(field.minLength, 1);
    assert.equal(field.maxLength, MAX_FIELD_CHARS);
  }
  assert.equal(fields.answer.maxLength, MAX_ANSWER_CHARS);
  assert.deepEqual(fields.answer.type, ["string", "null"]);
  assert.deepEqual(fields.pronunciation.type, ["string", "null"]);
  const label = fields.senses.items.properties.labels;
  assert.equal(label.maxItems, MAX_SENSE_LABELS);
  assert.deepEqual(label.items.properties.kind.enum, [...LABEL_KINDS]);
  assert.deepEqual(label.items.properties.category.anyOf, [
    { type: "string", enum: [...PARTS_OF_SPEECH] },
    { type: "null" },
  ]);
  assert.equal(label.items.properties.text.minLength, 1);
  assert.deepEqual(label.items.required, ["kind", "category", "text"]);
  assert.equal(label.items.additionalProperties, false);
  assert.equal(
    fields.senses.items.properties.examples.maxItems,
    MAX_EXAMPLES,
  );
  assert.deepEqual(fields.kind.enum, ["vocabulary", "note"]);
  assert.deepEqual(fields.type.enum, ["concept", "cloze", "identify", "table"]);
  const [tableShape, noTable] = fields.table.anyOf;
  assert.deepEqual(noTable, { type: "null" });
  assert.equal(tableShape.properties.columns.maxItems, MAX_TABLE_COLUMNS);
  assert.equal(tableShape.properties.rows.maxItems, MAX_TABLE_ROWS);
  assert.equal(
    tableShape.properties.rows.items.maxItems,
    MAX_TABLE_COLUMNS,
  );
  assert.equal(
    tableShape.properties.rows.items.items.maxLength,
    MAX_FIELD_CHARS,
  );
  assert.equal(
    tableShape.properties.blanks.maxItems,
    MAX_TABLE_COLUMNS * MAX_TABLE_ROWS,
  );
  assert.deepEqual(tableShape.required, ["columns", "rows", "blanks"]);
  assert.deepEqual(tableShape.properties.blanks.items.required, [
    "row",
    "column",
  ]);
  assert.equal(tableShape.additionalProperties, false);
  assert.equal(tableShape.properties.blanks.items.additionalProperties, false);
  const [clozeShape, noCloze] = fields.cloze.anyOf;
  assert.deepEqual(noCloze, { type: "null" });
  assert.equal(clozeShape.properties.answers.maxItems, MAX_CLOZE_BLANKS);
  assert.equal(clozeShape.properties.answers.items.minLength, 1);
  assert.deepEqual(clozeShape.required, ["answers"]);
  assert.equal(clozeShape.additionalProperties, false);
  assert.equal(fields.topic.maxLength, MAX_TOPIC_CHARS);
  assert.equal(fields.senses.maxItems, MAX_SENSES);
  assert.deepEqual(fields.senses.items.required, [
    "labels",
    "meaning",
    "examples",
  ]);
  assert.equal(fields.extras.maxItems, MAX_EXTRAS);
  assert.deepEqual(fields.extras.items.required, ["label", "text"]);
  assert.equal(fields.examples.maxItems, MAX_EXAMPLES);
  assert.equal(fields.examples.items.maxLength, MAX_FIELD_CHARS);
  const keys = [
    "kind",
    "type",
    "front",
    "answer",
    "topic",
    "senses",
    "extras",
    "pronunciation",
    "examples",
    "table",
    "cloze",
  ];
  assert.deepEqual(
    Object.keys(fields),
    keys,
    "no short form, step or part of speech",
  );
  assert.deepEqual(cards.items.required, keys);
  assert.equal(cards.items.additionalProperties, false);
  assert.equal(fields.senses.items.additionalProperties, false);
  assert.equal(fields.extras.items.additionalProperties, false);
});

/**
 * For each rule, a card that breaks it and no rule checked before it. The type names every rule
 * of `CARD_RULES`, so a rule added without a card here fails the type check.
 */
const BREAKING: Record<CardRule, unknown> = {
  fields: item({ short: "x" }),
  kind: item({ kind: "word" }),
  type: item({ type: "flip" }),
  front: item({ front: " " }),
  answer: note({ answer: "a".repeat(MAX_ANSWER_CHARS + 1) }),
  topic: item({ topic: "a".repeat(MAX_TOPIC_CHARS + 1) }),
  pronunciation: item({ pronunciation: "" }),
  examples: item({ examples: ["a", "b", "c", "d", "e", "f"] }),
  senses: item({ senses: [{ pos: "n", meaning: "사과" }] }),
  sense_meaning: item({ senses: [sense(" ")] }),
  sense_examples: item({
    senses: [{ labels: [], meaning: "사과", examples: [""] }],
  }),
  sense_labels: item({
    senses: [sense("사과", [{ kind: "other", text: "x" }])],
  }),
  label_text: item({
    senses: [sense("사과", [{ kind: "other", category: null, text: "[ ]" }])],
  }),
  label_kind: item({
    senses: [sense("사과", [{
      kind: "part_of_speech",
      category: "gerund",
      text: "x",
    }])],
  }),
  extras: item({ extras: [{ label: "유의어", text: "" }] }),
  table_fields: table({ table: { ...TABLE, note: "x" } }),
  table_columns: tableWith({ columns: [] }),
  table_rows: tableWith({ rows: [["1인칭", "저"]] }),
  table_cells: tableWith({
    rows: [
      ["1인칭", "저, 저희", "a".repeat(MAX_FIELD_CHARS + 1)],
      TABLE.rows[1],
    ],
  }),
  table_blanks: tableWith({ blanks: [] }),
  table_blank_cells: tableWith({ blanks: [{ row: 5, column: 1 }] }),
  cloze_fields: cloze({ cloze: { answers: [] } }),
  note_fields: note({ pronunciation: "[x]" }),
  vocabulary_senses: item({ senses: [] }),
  vocabulary_answer: item({ answer: "사과" }),
  vocabulary_type: item({ type: "cloze" }),
  table_card: table({ answer: "표" }),
  cloze_card: cloze({ table: TABLE }),
  cloze_blanks: cloze({ front: "3인칭 재귀칭: {{c1::자기}}" }),
  concept_card: note({ answer: null }),
};

Deno.test("every rule the parser refuses a card by is stated in the output contract, and each is reachable", () => {
  const refusedBy = new Set<CardRule>();
  for (const [rule, card] of Object.entries(BREAKING)) {
    const parsed = parseCard(card);
    assert.ok(parsed instanceof Refusal, `${rule}: refused`);
    assert.equal(parsed.rule, rule);
    refusedBy.add(parsed.rule);
  }
  assert.deepEqual([...refusedBy].sort(), Object.keys(CARD_RULES).sort());
  const contractLines = OUTPUT_CONTRACT.split("\n");
  for (const [rule, sentence] of Object.entries(CARD_RULES)) {
    assert.ok(contractLines.includes(`- ${sentence}`), rule);
  }
  // Control: each kind of card the breaking ones are made from is accepted.
  for (const card of [item(), note(), table(), cloze()]) {
    assert.ok(!(parseCard(card) instanceof Refusal), JSON.stringify(card));
  }
});

Deno.test("the output contract names every field of the schema, the card limit and every part of speech", () => {
  for (
    const key of Object.keys(cardsSchema.properties.cards.items.properties)
  ) {
    assert.ok(OUTPUT_CONTRACT.includes(`\n- "${key}": `), key);
  }
  assert.ok(OUTPUT_CONTRACT.includes(`at most ${MAX_CARDS} cards`));
  for (const category of PARTS_OF_SPEECH) {
    assert.ok(OUTPUT_CONTRACT.includes(`"${category}"`), category);
  }
});

Deno.test("the output contract is written for the material, never for a photo or a page", () => {
  const sourceWords = /photo|image|picture|page|사진/i;
  assert.doesNotMatch(OUTPUT_CONTRACT, sourceWords);
  assert.match(OUTPUT_CONTRACT, /the material/);
  // Control: prompt v9, written for a photo of a page, matches the same expression.
  assert.match(V9, sourceWords);
});

Deno.test("the model's instructions are the served prompt's text unchanged, then the output contract", () => {
  const prompt = "  Saved instructions.\r\n";
  assert.equal(composeInstructions(prompt), `${prompt}\n\n${OUTPUT_CONTRACT}`);
  assert.ok(OUTPUT_CONTRACT.startsWith("# Output contract\n"));
});

Deno.test("parseReply keeps the cards that keep every rule, in order, and names the rule of each card it drops", () => {
  const parsed = parseReply(reply([
    BREAKING.vocabulary_answer,
    item(),
    BREAKING.cloze_blanks,
    note(),
  ]));
  assert.deepEqual(parsed?.cards.map((card) => card.front), [
    "apple",
    "연역 논증과 귀납 논증의 차이",
  ]);
  assert.deepEqual(parsed?.dropped, ["vocabulary_answer", "cloze_blanks"]);
  // The strict reading refuses the same reply whole.
  assert.equal(parseCards(reply([BREAKING.vocabulary_answer, item()])), null);
  // Control: a reply of valid cards drops none, read either way.
  assert.deepEqual(parseReply(reply([item(), note()]))?.dropped, []);
  assert.equal(parseCards(reply([item(), note()]))?.length, 2);
});

Deno.test("parseReply refuses a reply that is not the schema's envelope whatever its cards", () => {
  for (
    const text of [
      "{",
      reply("a"),
      JSON.stringify({ cards: [item()], note: "x" }),
      "[]",
      reply(Array.from({ length: MAX_CARDS + 1 }, () => item())),
    ]
  ) {
    assert.equal(parseReply(text), null, text.slice(0, 40));
  }
  // Control: the envelope of exactly the card limit is read.
  assert.equal(
    parseReply(reply(Array.from({ length: MAX_CARDS }, () => item())))?.cards
      .length,
    MAX_CARDS,
  );
});

Deno.test("closeCutReply closes a cut reply after its last whole card, braces inside text left alone", () => {
  const braced = item({ front: 'a "{[" b' });
  const whole = reply([item(), braced, note()]);
  // Cut inside the note, after the card holding braces and a quote in its text.
  const cut = whole.slice(0, whole.length - 20);
  const closed = closeCutReply(cut);
  assert.deepEqual(
    parseReply(closed ?? "")?.cards.map((card) => card.front),
    ["apple", 'a "{[" b'],
  );
  // The cards it keeps are read by the same rules: a broken one is dropped.
  const broken = reply([BREAKING.vocabulary_answer, item(), note()]);
  assert.deepEqual(
    parseReply(closeCutReply(broken.slice(0, -20)) ?? "")?.dropped,
    ["vocabulary_answer"],
  );
  // Control: a cut before any card is whole closes nothing.
  assert.equal(closeCutReply(reply([item()]).slice(0, -20)), null);
});

Deno.test("the output contract asks for card text in the markup and an Anki cloze, and never a blank written ___", () => {
  assert.match(OUTPUT_CONTRACT, /## Card text/);
  assert.match(OUTPUT_CONTRACT, /\*\*bold\*\*/);
  assert.match(OUTPUT_CONTRACT, /\{\{c1::answer\}\}/);
  assert.match(OUTPUT_CONTRACT, /write a backslash before it/);
  assert.doesNotMatch(
    OUTPUT_CONTRACT.replace("never writes a blank as ___", ""),
    /___/,
  );
});
