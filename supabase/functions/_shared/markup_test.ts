// The server's reader of card text markup held to the engine's fixtures, read from the repository
// (`engine/tests/fixtures/markup/`) and not copied, so the two readers cannot drift apart.
import assert from "node:assert/strict";
import cloze from "../../../engine/tests/fixtures/markup/cloze.json" with {
  type: "json",
};
import escape from "../../../engine/tests/fixtures/markup/escape.json" with {
  type: "json",
};
import parse from "../../../engine/tests/fixtures/markup/parse.json" with {
  type: "json",
};
import plain from "../../../engine/tests/fixtures/markup/plain.json" with {
  type: "json",
};
import {
  clozeNumbers,
  escapeLiteral,
  fillCloze,
  hideCloze,
  parseMarkup,
  plainText,
} from "./markup.ts";

Deno.test("the fixtures are read whole", () => {
  assert.ok(parse.length > 100, "parse.json");
  assert.ok(cloze.length > 10, "cloze.json");
  assert.ok(plain.length > 5, "plain.json");
  assert.ok(escape.length > 5, "escape.json");
});

for (const { name, input, document } of parse) {
  Deno.test(`parses as the engine does: ${name}`, () => {
    assert.deepEqual(parseMarkup(input), document);
  });
}

for (const { name, input, numbers, hidden, filled } of cloze) {
  Deno.test(`reads a cloze as the engine does: ${name}`, () => {
    const document = parseMarkup(input);
    assert.deepEqual(clozeNumbers(document), numbers);
    assert.deepEqual(fillCloze(document), filled);
    assert.deepEqual(Object.keys(hidden), numbers.map(String));
    for (const number of numbers) {
      assert.deepEqual(
        hideCloze(document, number),
        (hidden as Record<string, unknown>)[String(number)],
      );
    }
  });
}

for (const { name, input, plainText: expected } of plain) {
  Deno.test(`gives the key's plain text as the engine does: ${name}`, () => {
    assert.equal(plainText(parseMarkup(input)), expected);
  });
}

for (const { name, text, escaped } of escape) {
  Deno.test(`escapes a literal text as the engine does: ${name}`, () => {
    assert.equal(escapeLiteral(text), escaped);
  });
}

/** A seeded generator of texts made of the characters the grammar gives meaning to. */
function generated(count: number): string[] {
  let state = 12345;
  const next = (bound: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % bound;
  };
  const pieces = [
    "a",
    " ",
    "\n",
    "\\",
    "*",
    "**",
    "_",
    "`",
    "{{c1::",
    "}}",
    "::",
    "-",
    "1.",
    "- ",
    "1. ",
    "가",
    "\r\n",
    "\t",
    "  ",
    "{",
    "}",
    ":",
    "x y",
    "___",
  ];
  return Array.from(
    { length: count },
    () =>
      Array.from({ length: next(14) }, () => pieces[next(pieces.length)]!).join(
        "",
      ),
  );
}

Deno.test("an escaped text reads back as itself with no mark, list or cloze, for generated texts", () => {
  for (const text of generated(2000)) {
    const document = parseMarkup(escapeLiteral(text));
    assert.equal(
      plainText(document),
      text.replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
      JSON.stringify(text),
    );
    assert.deepEqual(clozeNumbers(document), [], JSON.stringify(text));
    const marked = JSON.stringify(document);
    for (const type of ["bold", "italic", "code", "list", "cloze"]) {
      assert.ok(!marked.includes(`"type":"${type}"`), JSON.stringify(text));
    }
  }
  // Control: the unescaped text of the same generator does hold marks, so the check can fail.
  assert.ok(
    generated(2000).some((text) =>
      clozeNumbers(parseMarkup(text)).length > 0 ||
      JSON.stringify(parseMarkup(text)).includes('"type":"bold"')
    ),
  );
});
