import { escapeLiteral, plainText } from "@/design/markup-engine";

/** An Anki field as card text markup, and the names of the images its HTML shows, in order. */
export type FieldMarkup = { markup: string; images: string[] };

type Segment = { text: string; bold: boolean; italic: boolean };
type Line = { prefix: string; segments: Segment[] };

const blockTags = new Set([
  "DIV",
  "P",
  "UL",
  "OL",
  "LI",
  "TABLE",
  "TR",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "PRE",
]);
const skipTags = new Set(["SCRIPT", "STYLE", "HEAD", "TEMPLATE"]);

/** The lines an Anki field's HTML reads as: its marks kept where the markup subset has them (ADR 0222). */
class Reader {
  lines: Line[] = [];
  images: string[] = [];
  private current: Line = { prefix: "", segments: [] };
  private lists: { ordered: boolean; count: number }[] = [];

  walk(node: Node, bold: boolean, italic: boolean): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\s+/gu, " ");
      if (text !== "") this.current.segments.push({ text, bold, italic });
      return;
    }
    if (!(node instanceof Element) || skipTags.has(node.tagName)) return;
    const tag = node.tagName;
    if (tag === "BR") {
      this.close();
      return;
    }
    if (tag === "IMG") {
      const src = node.getAttribute("src");
      if (src) this.images.push(decoded(src));
      return;
    }
    if (tag === "UL" || tag === "OL") this.lists.push({ ordered: tag === "OL", count: 0 });
    const block = blockTags.has(tag);
    if (block) this.close();
    if (tag === "LI") this.item();
    const marks = [
      bold || tag === "B" || tag === "STRONG",
      italic || tag === "I" || tag === "EM",
    ] as const;
    for (const child of node.childNodes) this.walk(child, ...marks);
    if (block) this.close();
    if (tag === "UL" || tag === "OL") this.lists.pop();
  }

  /** Starts a list item's line: its marker, the second level of a nested list indented. */
  private item(): void {
    const list = this.lists[this.lists.length - 1];
    if (!list) return;
    list.count += 1;
    const indent = this.lists.length > 1 ? "  " : "";
    this.current.prefix = `${indent}${list.ordered ? `${String(list.count)}.` : "-"} `;
  }

  /** Ends the line being read; a line holding no text is dropped. */
  close(): void {
    const text = this.current.segments.map((s) => s.text).join("");
    if (text.trim() !== "") this.lines.push(this.current);
    this.current = { prefix: "", segments: [] };
  }
}

function decoded(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}

/** [text] trimmed of spaces, the spaces it had at each end apart from it. */
function trimmed(text: string): { lead: string; core: string; trail: string } {
  const core = text.trim();
  if (core === "") return { lead: text, core, trail: "" };
  return {
    lead: text.slice(0, text.indexOf(core)),
    core,
    trail: text.slice(text.indexOf(core) + core.length),
  };
}

/** A line's text with its segments' spaces trimmed at the ends, merged by the marks they share. */
function lineSegments(line: Line): Segment[] {
  const merged: Segment[] = [];
  for (const segment of line.segments) {
    const last = merged[merged.length - 1];
    if (last && last.bold === segment.bold && last.italic === segment.italic)
      last.text += segment.text;
    else merged.push({ ...segment });
  }
  const first = merged[0];
  const last = merged[merged.length - 1];
  if (first) first.text = first.text.trimStart();
  if (last) last.text = last.text.trimEnd();
  return merged.filter((segment) => segment.text !== "");
}

/** [text] as markup text; in a cloze, the braces and colons of its `{{cN::…}}` stay as written. */
function literal(text: string, atLineStart: boolean, cloze: boolean): string {
  const escaped = atLineStart ? escapeLiteral(text) : escapeLiteral(`x${text}`).slice(1);
  return cloze ? escaped.replace(/\\([{}:])/gu, "$1") : escaped;
}

function markupLine(line: Line, cloze: boolean): string {
  const body = lineSegments(line)
    .map((segment, at) => {
      const { lead, core, trail } = trimmed(segment.text);
      const text = literal(core, at === 0 && line.prefix === "", cloze);
      const mark = `${segment.bold ? "**" : ""}${segment.italic ? "*" : ""}`;
      const flipped = `${segment.italic ? "*" : ""}${segment.bold ? "**" : ""}`;
      return core === "" ? segment.text : `${lead}${mark}${text}${flipped}${trail}`;
    })
    .join("");
  return `${line.prefix}${body}`;
}

function plainLine(line: Line): string {
  return lineSegments(line)
    .map((segment) => segment.text)
    .join("");
}

/** A cloze's text with each deletion as its answer, as the engine's `plainText` fills it. */
function filled(text: string): string {
  return text.replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/gu, "$1");
}

/**
 * An Anki field's HTML as card text markup: `<b>`, `<strong>`, `<i>`, `<em>`, lists, `<br>` and the
 * lines of `<div>` and `<p>` kept, all other HTML stripped to its text. Every literal run passes
 * through `escapeLiteral`; if the engine does not read the markup back as the HTML's own text, the
 * field is written as that text alone. In a [cloze] field the `{{cN::…}}` stays as written, and a
 * field that reads back wrong even as text, or holds no deletion, is null (ADR 0222).
 */
export function fieldMarkup(html: string, cloze = false): FieldMarkup | null {
  const reader = new Reader();
  const body = new DOMParser().parseFromString(html, "text/html").body;
  reader.walk(body, false, false);
  reader.close();
  const text = reader.lines.map(plainLine).join("\n");
  const expected = cloze ? filled(text) : text;
  const reads = (markup: string) => plainText(markup) === expected;
  const marked = reader.lines.map((line) => markupLine(line, cloze)).join("\n");
  if (reads(marked)) return { markup: marked, images: reader.images };
  const bare = reader.lines.map((line) => literal(plainLine(line), true, cloze)).join("\n");
  if (reads(bare)) return { markup: bare, images: reader.images };
  return null;
}
