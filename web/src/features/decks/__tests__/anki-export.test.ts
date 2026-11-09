import { describe, expect, it } from "vitest";

import { ankiNotes } from "../anki-export";
import { parseCardContent } from "../card-content";
import type { Card, CardId, DeckId } from "../library";

/** A card of one stored 칸 list, as the library reads it. */
function card(...cells: unknown[]): Card {
  const content = parseCardContent({
    front: cells,
    back: [],
    template: "free",
    templateVersion: 2,
  });
  if (!content) throw new Error("the cells did not parse");
  return { id: "c" as CardId, deckId: "d" as DeckId, createdAt: 0, ...content };
}
const text = (front: string, back: string, v = 3) => ({
  type: "text",
  v,
  id: "t",
  payload: { front, back },
});
const cloze = (source: string) => ({ type: "cloze", v: 2, id: "c", payload: { text: source } });

/** The rows after the headers, split into their columns. */
function rows(file: string): string[][] {
  return file
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => line.split("\t"));
}

describe("a note exported to Anki's plain text", () => {
  it("opens with the separator, html and column headers Anki's own export writes", () => {
    expect(ankiNotes("영단어", []).text).toBe(
      "#separator:tab\n#html:true\n#notetype column:1\n#deck column:2\n",
    );
  });

  it("writes a markup 글 as a Basic note with its marks as HTML", () => {
    const {
      text: file,
      basic,
      cloze: clozes,
    } = ankiNotes("n", [card(text("**apple** and `a<b`", "- x\n- y"))]);

    expect(rows(file)).toEqual([
      ["Basic", "n", "<b>apple</b> and <code>a&lt;b</code>", "<ul><li>x</li><li>y</li></ul>"],
    ]);
    expect([basic, clozes]).toEqual([1, 0]);
  });

  it("writes a line break as <br> and a literal 글 as typed, never as markup", () => {
    const { text: file } = ankiNotes("n", [card(text("*a*\nb", "1. no & <i>", 2))]);

    expect(rows(file)).toEqual([["Basic", "n", "*a*<br>b", "1. no &amp; &lt;i&gt;"]]);
  });

  it("writes a cloze as a Cloze note keeping every {{cN::answer::hint}}", () => {
    const { text: file, cloze: clozes } = ankiNotes("n", [
      card(cloze("{{c1::Paris::city}} is in {{c2::**France**}}")),
    ]);

    expect(rows(file)).toEqual([
      ["Cloze", "n", "{{c1::Paris::city}} is in {{c2::<b>France</b>}}", ""],
    ]);
    expect(clozes).toBe(1);
  });

  it("writes a version 1 cloze with its blanks as numbered clozes", () => {
    const old = {
      type: "cloze",
      v: 1,
      id: "c",
      payload: { text: "___ is red", answers: ["Rose"] },
    };

    expect(rows(ankiNotes("n", [card(old)]).text)).toEqual([
      ["Cloze", "n", "{{c1::Rose}} is red", ""],
    ]);
  });

  it("keeps a literal {{c1:: in a Basic note from reading as a cloze in Anki, and a literal :: from splitting a hint", () => {
    const literal = ankiNotes("n", [card(text("\\{\\{c1\\:\\:x\\}\\}", "b"))]);
    const inCloze = ankiNotes("n", [card(cloze("{{c1::a\\:\\:b::h}}"))]);

    expect(rows(literal.text)[0]?.[2]).toBe("&#123;&#123;c1::x&#125;&#125;");
    expect(rows(inCloze.text)[0]?.[2]).toBe("{{c1::a&#58;&#58;b::h}}");
  });

  it("writes a card that is not a 글 or cloze as a Basic note of its text, and leaves out one with none", () => {
    const word = {
      type: "senses",
      v: 2,
      id: "w",
      payload: {
        term: "apple",
        ask: "term",
        senses: [{ labels: [], meaning: "사과", examples: [] }],
      },
    };
    const photo = {
      type: "image",
      v: 2,
      id: "p",
      payload: { media: "m", width: 1, height: 1, boxes: [], side: "front" },
    };
    const result = ankiNotes("n", [card(word), card(photo), card(text("q", "a"))]);

    expect(rows(result.text).map(([, , front, back]) => [front, back])).toEqual([
      ["apple", "사과"],
      ["q", "a"],
    ]);
    expect([result.basic, result.flattened, result.skipped]).toEqual([2, 1, 1]);
  });

  it("quotes a field holding a tab or a quote, and writes a deck name Anki reads as one deck", () => {
    const { text: file } = ankiNotes(" 영어::단어 ", [card(text('say "hi"\tnow', "b"))]);

    expect(file).toContain('Basic\t영어:단어\t"say ""hi""\tnow"\tb\n');
  });
});
