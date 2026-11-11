// What a card of `add_cards` is written as (ADR 0254): `text` version 3 and `cloze` version 2, the
// only forms there are, and what is refused, the older cloze form among it.
import assert from "node:assert/strict";
import { blocksOut, cellsOf } from "./frame.ts";
import { type IdSource } from "./cards.ts";
import { type ReadCard, readCard } from "./input.ts";

const ids: IdSource = {
  now: () => 1_700_000_000_000,
  random: (bytes) => new Uint8Array(bytes).fill(7),
};

/** The one block [value] is written as, by type, version and payload; its refusal otherwise. */
function written(value: Record<string, unknown>) {
  const card = readCard({ blocks: [value] }, ids);
  assert.equal(typeof card, "object", String(card));
  const [block] = (card as ReadCard).blocks;
  return { type: block!.type, v: block!.v, payload: block!.payload };
}

const text = (front: string, back = "") => ({ type: "text", front, back });
const cloze = (source: string) => ({ type: "cloze", text: source });
const sentence = "The capital of France is {{c1::Paris}}.";

Deno.test("a text is written as version 3 exactly as given: a list, a mark and a backslash included", () => {
  const given = [
    text("Capital?", "Paris"),
    text("준비물\n- 여권\n- 지갑", "1. 첫째\n2. 둘째"),
    text("2*3*4 and **x**", "C:\\Users\\me and 2\\*3"),
    text("What is {{c1::x}}?", "`code` _it_"),
  ];
  for (const input of given) {
    assert.deepEqual(written(input), {
      type: "text",
      v: 3,
      payload: { front: input.front, back: input.back },
    });
  }
});

Deno.test("the plain front and back are read as a text block of version 3", () => {
  const card = readCard({ front: "Q: *x*", back: "A" }, ids) as ReadCard;
  assert.equal(card.blocks[0]!.v, 3);
});

Deno.test("a cloze in Anki's syntax is written as version 2, with no answers", () => {
  assert.deepEqual(written(cloze(sentence)), {
    type: "cloze",
    v: 2,
    payload: { text: sentence },
  });
  // Marks, hints, a number used twice and numbers out of order are all the text's own.
  for (
    const source of [
      "{{c1::Paris::city}} is a city",
      "{{c1::a}} and {{c1::b}}",
      "{{c2::a}} {{c1::b}}",
      "{{c1::**a**}} b",
      "*note* {{c1::a}}",
      "- {{c1::a}}",
    ]
  ) {
    assert.deepEqual(
      written(cloze(source)),
      { type: "cloze", v: 2, payload: { text: source } },
      source,
    );
  }
});

Deno.test("a cloze in version 1's form, text with ___ and answers, is refused with a sentence giving the form to send", () => {
  const old = {
    type: "cloze",
    text: "The capital of France is ___.",
    answers: ["Paris"],
  };
  const read = readCard({ blocks: [old] }, ids);
  assert.equal(typeof read, "string");
  assert.match(
    read as string,
    /^block 0: a cloze takes its text alone, with each hidden part written \{\{c1::answer\}\}/,
  );
  assert.match(
    read as string,
    /send \{"type":"cloze","text":"The capital is \{\{c1::Paris\}\}\.\"\} and no answers/,
  );
  // Control: the same sentence in Anki's syntax is accepted, so the answers alone are what refuse.
  assert.equal(
    typeof readCard({
      blocks: [cloze("The capital of France is {{c1::Paris}}.")],
    }, ids),
    "object",
  );
  // An empty answers list is the old form too.
  assert.equal(
    typeof readCard({ blocks: [{ ...old, answers: [] }] }, ids),
    "string",
  );
});

Deno.test("a cloze text with no cloze, an empty answer, a cloze inside another or an unclosed one is refused with a sentence, and the same text with a complete cloze is accepted", () => {
  const refused = (source: string) =>
    readCard({ blocks: [cloze(source)] }, ids);
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

Deno.test("a cloze needs its text to be text", () => {
  assert.match(
    readCard({ blocks: [{ type: "cloze", text: 5 }] }, ids) as string,
    /a cloze/,
  );
});

Deno.test("the card key is the plain text of its markup", () => {
  const key = (value: Record<string, unknown>) =>
    (readCard({ blocks: [value] }, ids) as ReadCard).key;
  assert.equal(key(text("What is **Paris**?", "x")), "what is paris?");
  assert.equal(key(text("What is Paris?", "x")), "what is paris?");
  assert.equal(key(cloze(sentence)), "the capital of france is paris.");
});

Deno.test("list_cards' form of a stored card is the card as stored, and sends back as the same card", () => {
  const stored = (v: number, payload: Record<string, unknown>) =>
    cellsOf({
      front: [{ type: "text", v, id: "a", payload }],
      back: [],
      template: "free",
      template_version: 2,
    })!;
  const markup = { front: "Note\\: 2\\*3\\*4 **b**", back: "- plain" };
  const shown = blocksOut(stored(3, markup));
  assert.deepEqual(shown, [{ type: "text", ...markup }]);
  const again = written(shown[0]!);
  assert.deepEqual(again, { type: "text", v: 3, payload: markup });
});

Deno.test("a stored cloze of version 2 is read as the cloze it is, its key the filled text, and shown as its text alone", () => {
  const cells = cellsOf({
    front: [{ type: "cloze", v: 2, id: "c", payload: { text: sentence } }],
    back: [],
    template: "free",
    template_version: 2,
  })!;
  assert.deepEqual(blocksOut(cells), [{
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
