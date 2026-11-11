import { describe, expect, it } from "vitest";

import { markupFixtures } from "@/testing/markup-fixtures";

import {
  clozeNumbers,
  documentText,
  escapeLiteral,
  hasFormatting,
  markedOf,
  parse,
  plainText,
} from "../markup-engine";

describe("the markup engine, as the browser's module answers", () => {
  it.each(markupFixtures.parse)("parses $name as its fixture's document", ({ input, document }) => {
    // JSON, so a hint the module returned as `undefined` where the fixture has `null` fails here.
    expect(JSON.parse(JSON.stringify(parse(input)))).toEqual(document);
  });

  it.each(markupFixtures.cloze)("reads the clozes of $name", ({ input, numbers, filled }) => {
    expect(clozeNumbers(input)).toEqual(numbers);
    expect(JSON.parse(JSON.stringify(markedOf(input).document))).toEqual(
      JSON.parse(JSON.stringify(parse(input))),
    );
    expect(plainText(input)).toBe(documentText(filled));
  });

  it.each(markupFixtures.plain)("writes the plain text of $name", ({ input, plainText: plain }) => {
    expect(plainText(input)).toBe(plain);
    expect(markedOf(input).plain).toBe(plain);
  });

  it.each(markupFixtures.escape)(
    "escapes $name so it reads back as itself",
    ({ text, escaped }) => {
      expect(escapeLiteral(text)).toBe(escaped);
      expect(plainText(escaped)).toBe(text.replaceAll("\r\n", "\n").replaceAll("\r", "\n"));
    },
  );

  it.each(markupFixtures.escape.filter(({ text }) => !/[\r\n]/u.test(text)))(
    "reads the escaped $name as one line holding no mark, list or cloze",
    ({ escaped }) => {
      expect(hasFormatting(parse(escaped))).toBe(false);
      expect(clozeNumbers(escaped)).toEqual([]);
    },
  );

  it("reads a text of marks as formatting and a plain one as written", () => {
    expect(hasFormatting(parse("**bold**"))).toBe(true);
    expect(hasFormatting(parse("- a"))).toBe(true);
    expect(hasFormatting(parse("a\nb"))).toBe(true);
    expect(hasFormatting(parse("{{c1::a}}"))).toBe(true);
    expect(hasFormatting(parse("plain"))).toBe(false);
  });
});
