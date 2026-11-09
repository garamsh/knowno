import { describe, expect, it } from "vitest";

import { fieldMarkup } from "../anki-html";

const markup = (html: string, cloze = false) => fieldMarkup(html, cloze)?.markup;

describe("fieldMarkup", () => {
  it("keeps bold and italic, from either tag", () => {
    expect(markup("a <b>bold</b> <strong>b2</strong> <i>it</i> <em>i2</em>")).toBe(
      "a **bold** **b2** *it* *i2*",
    );
  });

  it("keeps lines from <br>, <div> and <p>, dropping empty ones", () => {
    expect(markup("one<br>two<div>three</div><p>four</p><br><br>five")).toBe(
      "one\ntwo\nthree\nfour\nfive",
    );
  });

  it("keeps lists and one level of nesting", () => {
    expect(
      markup("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul><ol><li>x</li><li>y</li></ol>"),
    ).toBe("- a\n  - b\n- c\n1. x\n2. y");
  });

  it("strips any other HTML to its text and decodes entities", () => {
    expect(
      markup('<span style="color:red">a &amp; b &lt;c&gt;</span><script>x()</script>&nbsp;d'),
    ).toBe("a & b <c> d");
  });

  it("escapes what the markup would read as a mark, so the text reads back as written", () => {
    expect(markup("2 * 3 = 6, snake_case, {braces}<br>1. not a list<br>- not a bullet")).toBe(
      "2 \\* 3 = 6, snake\\_case, \\{braces\\}\n\\1. not a list\n\\- not a bullet",
    );
  });

  it("moves a mark's edge spaces outside it", () => {
    expect(markup("<b> bold </b>text")).toBe("**bold** text");
  });

  it("names the images in order, decoding their names", () => {
    expect(fieldMarkup('x<img src="a%20b.png"><img src="c.jpg">')).toEqual({
      markup: "x",
      images: ["a b.png", "c.jpg"],
    });
  });

  it("keeps a cloze as written, with its hint and the marks in its answer", () => {
    expect(markup("{{c1::<b>Spain</b>::country}} and {{c2::x}}", true)).toBe(
      "{{c1::**Spain**::country}} and {{c2::x}}",
    );
  });

  it("reads a cloze field holding no deletion as its text, for the caller to skip", () => {
    expect(markup("no deletion here", true)).toBe("no deletion here");
  });
});
