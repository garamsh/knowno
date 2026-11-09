// What a card of `add_cards` is written as (ADR 0216): the forms the released clients read while the
// markup's switch is off, the markup's forms while it is on, what is accepted either way, and what
// is refused.
import assert from "node:assert/strict";
import { blocksOut, cellsOf } from "./frame.ts";
import { type IdSource } from "./cards.ts";
import { type ReadCard, readCard, type Writes } from "./input.ts";

const ids: IdSource = {
  now: () => 1_700_000_000_000,
  random: (bytes) => new Uint8Array(bytes).fill(7),
};
const OFF: Writes = { markup: false };
const ON: Writes = { markup: true };

/** The one block [value] is written as, by type, version and payload; its refusal otherwise. */
function written(value: Record<string, unknown>, writes: Writes) {
  const card = readCard({ blocks: [value] }, ids, null, writes);
  assert.equal(typeof card, "object", String(card));
  const [block] = (card as ReadCard).blocks;
  return { type: block!.type, v: block!.v, payload: block!.payload };
}

const text = (front: string, back = "") => ({ type: "text", front, back });
const cloze = (source: string) => ({ type: "cloze", text: source });
const sentence = "The capital of France is {{c1::Paris}}.";

Deno.test("a text of plain words is written as version 2 while the switch is off, and as version 3 while it is on", () => {
  assert.deepEqual(written(text("Capital?", "Paris"), OFF), {
    type: "text",
    v: 2,
    payload: { front: "Capital?", back: "Paris" },
  });
  assert.deepEqual(written(text("Capital?", "Paris"), ON), {
    type: "text",
    v: 3,
    payload: { front: "Capital?", back: "Paris" },
  });
});

Deno.test("while the switch is off a text is literal: written at version 2 exactly as given, a list, a mark and a backslash included, and while on it is markup at version 3", () => {
  const given = [
    text("준비물\n- 여권\n- 지갑", "1. 첫째\n2. 둘째"),
    text("2*3*4 and **x**", "C:\\Users\\me and 2\\*3"),
    text("What is {{c1::x}}?", "`code` _it_"),
  ];
  for (const input of given) {
    assert.deepEqual(written(input, OFF), {
      type: "text",
      v: 2,
      payload: { front: input.front, back: input.back },
    });
    assert.deepEqual(written(input, ON), {
      type: "text",
      v: 3,
      payload: { front: input.front, back: input.back },
    });
  }
  // Control: the accepted literal is written the same way, so the lists are told from it by nothing.
  assert.deepEqual(written(text("snake_case", "a * b"), OFF), {
    type: "text",
    v: 2,
    payload: { front: "snake_case", back: "a * b" },
  });
});

Deno.test("the plain front and back are read as a text block, in either state", () => {
  const read = (writes: Writes) =>
    readCard({ front: "Q: *x*", back: "A" }, ids, null, writes) as ReadCard;
  assert.equal(read(OFF).blocks[0]!.v, 2);
  assert.equal(read(ON).blocks[0]!.v, 3);
});

Deno.test("a cloze in version 1's form is written as version 1 while off, and as version 2 with its literals escaped while on", () => {
  const v1 = {
    type: "cloze",
    text: "a*b is ___ and c::d is ___",
    answers: ["x", "y}}z"],
  };
  assert.deepEqual(written(v1, OFF), {
    type: "cloze",
    v: 1,
    payload: { text: v1.text, answers: v1.answers },
  });
  assert.deepEqual(written(v1, ON), {
    type: "cloze",
    v: 2,
    payload: {
      text: "a\\*b is {{c1::x}} and c\\:\\:d is {{c2::y\\}\\}z}}",
    },
  });
});

Deno.test("a version 1 cloze with no version 2 form stays version 1 even while on", () => {
  const blankLine = { type: "cloze", text: "a ___", answers: ["x\n\ny"] };
  assert.deepEqual(written(blankLine, ON), {
    type: "cloze",
    v: 1,
    payload: { text: "a ___", answers: ["x\n\ny"] },
  });
  // Control: an answer with no blank line converts.
  assert.equal(written({ ...blankLine, answers: ["x\ny"] }, ON).v, 2);
});

Deno.test("a cloze in Anki's syntax is written as version 2 while on, and as version 1 while off where one reads the same", () => {
  assert.deepEqual(written(cloze(sentence), ON), {
    type: "cloze",
    v: 2,
    payload: { text: sentence },
  });
  assert.deepEqual(written(cloze(sentence), OFF), {
    type: "cloze",
    v: 1,
    payload: { text: "The capital of France is ___.", answers: ["Paris"] },
  });
  assert.deepEqual(
    written(cloze("{{c1::a}}, {{c2::b *}}\nand {{c3::c\\*}}"), OFF).payload,
    { text: "___, ___\nand ___", answers: ["a", "b *", "c*"] },
  );
});

Deno.test("a cloze with no version 1 form is refused with a sentence while off, never stored at version 2, and written at version 2 while on", () => {
  const cases = {
    "a hint": "{{c1::Paris::city}} is a city",
    "one number twice": "{{c1::a}} and {{c1::b}}",
    "numbers out of order": "{{c2::a}} {{c1::b}}",
    "numbers that skip": "{{c1::a}} {{c3::b}}",
    "a mark in the answer": "{{c1::**a**}} b",
    "a mark in the text": "*note* {{c1::a}}",
    "a list": "- {{c1::a}}",
    "a literal blank": "x ___ {{c1::a}}",
  };
  for (const [name, source] of Object.entries(cases)) {
    const read = readCard({ blocks: [cloze(source)] }, ids, null, OFF);
    assert.match(
      read as string,
      /^block 0: a cloze in \{\{c1::answer\}\} form/,
      name,
    );
    assert.deepEqual(
      written(cloze(source), ON),
      { type: "cloze", v: 2, payload: { text: source } },
      name,
    );
  }
  // Control: the case that converts is accepted while off, so the reason alone is what refuses.
  assert.equal(written(cloze("{{c1::a}} {{c2::b}}"), OFF).v, 1);
});

Deno.test("a cloze text with no cloze, an empty answer, a cloze inside another or an unclosed one is refused with a sentence, and the same text with a complete cloze is accepted", () => {
  const refused = (source: string) =>
    readCard({ blocks: [cloze(source)] }, ids, null, ON);
  for (
    const source of [
      "no blank at all",
      "The capital is {{c1::}}.",
      "The capital is {{c1:: ::hint}}.",
      "The capital is {{c1::Paris",
      "{{c1::a {{c2::b}}}}",
      "\\{\\{c1::Paris}}",
      "{{c0::zero}}",
      "{{c1::Paris}} and {{c2::}}",
    ]
  ) {
    const read = refused(source);
    assert.equal(typeof read, "string", source);
    assert.match(read as string, /block 0: a cloze/, source);
    assert.equal(
      typeof readCard({ blocks: [cloze(source)] }, ids, null, OFF),
      "string",
      source,
    );
  }
  for (
    const source of [
      "The capital is {{c1::Paris}}.",
      "`{{c1::x}}` and {{c1::y}}",
      "a \\{\\{b {{c1::y}}",
    ]
  ) {
    assert.equal(typeof refused(source), "object", source);
  }
});

Deno.test("a cloze needs its text to be text, and a v1 cloze keeps v1's refusals", () => {
  assert.match(
    readCard({ blocks: [{ type: "cloze", text: 5 }] }, ids, null, ON) as string,
    /a cloze/,
  );
  const bad = { type: "cloze", text: "no blank", answers: ["x"] };
  assert.match(
    readCard({ blocks: [bad] }, ids, null, ON) as string,
    /a cloze needs text with one ___/,
  );
  assert.match(
    readCard({ blocks: [bad] }, ids, null, OFF) as string,
    /a cloze needs text with one ___/,
  );
});

Deno.test("the card key is the plain text of its markup, as of a literal, so a card is the same card in every form", () => {
  const key = (value: Record<string, unknown>, writes: Writes) =>
    (readCard({ blocks: [value] }, ids, null, writes) as ReadCard).key;
  assert.equal(key(text("What is **Paris**?", "x"), ON), "what is paris?");
  assert.equal(key(text("What is Paris?", "x"), ON), "what is paris?");
  const filled = key(cloze(sentence), ON);
  assert.equal(filled, "the capital of france is paris.");
  assert.equal(key(cloze(sentence), OFF), filled);
  assert.equal(
    key({
      type: "cloze",
      text: "The capital of France is ___.",
      answers: ["Paris"],
    }, ON),
    filled,
  );
});

Deno.test("list_cards' form of a stored card sends back as the same card: a literal text is escaped only where the markup would read it otherwise", () => {
  const stored = (v: number, payload: Record<string, unknown>) =>
    cellsOf({
      front: [{ type: "text", v, id: "a", payload }],
      back: [],
      template: "free",
      template_version: 2,
    })!;
  const literal = { front: "Note: 2*3*4", back: "plain" };
  const shown = blocksOut(stored(2, literal), true);
  assert.deepEqual(shown, [
    { type: "text", front: "Note\\: 2\\*3\\*4", back: "plain" },
  ]);
  const again = written(shown[0]!, ON);
  assert.equal(again.v, 3);
  // While off a stored literal is shown as stored, and sends back as the same version 2 text.
  const plainShown = blocksOut(stored(2, literal), false);
  assert.deepEqual(plainShown, [{ type: "text", ...literal }]);
  assert.deepEqual(written(plainShown[0]!, OFF), {
    type: "text",
    v: 2,
    payload: literal,
  });
  // A markup text is shown as stored.
  assert.deepEqual(
    blocksOut(stored(3, { front: "**a**", back: "" }), false),
    [{ type: "text", front: "**a**", back: "" }],
  );
  // Control: text the markup reads unchanged is not escaped, a colon included.
  assert.deepEqual(blocksOut(stored(2, { front: "Q: a", back: "b" }), true), [
    { type: "text", front: "Q: a", back: "b" },
  ]);
});

Deno.test("a stored cloze of version 2 is read as the cloze it is, its key the filled text, and shown as its text alone", () => {
  const cells = cellsOf({
    front: [{ type: "cloze", v: 2, id: "c", payload: { text: sentence } }],
    back: [],
    template: "free",
    template_version: 2,
  })!;
  assert.deepEqual(blocksOut(cells, false), [{
    type: "cloze",
    text: sentence,
  }]);
  // A cloze of version 2 holding no cloze reads as a block this build cannot show, as the clients read it.
  const none = cellsOf({
    front: [{ type: "cloze", v: 2, id: "c", payload: { text: "none" } }],
    back: [],
    template: "free",
    template_version: 2,
  })!;
  assert.equal(none[0]!.kind, "unknown");
});
