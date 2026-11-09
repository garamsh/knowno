/**
 * Card text markup as the server reads it (ADR 0202, ADR 0208, ADR 0216): a TypeScript reader of
 * the Markdown subset and Anki's cloze syntax, ported from `engine/src/markup.rs` and held to the
 * fixtures in `engine/tests/fixtures/markup/` by `markup_test.ts`. The document it returns has the
 * fixtures' JSON shape. Every text yields a document, and what the grammar cannot close is literal
 * text.
 */

/** Text inside a block. */
export type Inline =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "lineBreak" }
  | { readonly type: "bold"; readonly content: readonly Inline[] }
  | { readonly type: "italic"; readonly content: readonly Inline[] }
  | { readonly type: "code"; readonly text: string }
  | {
    readonly type: "cloze";
    readonly number: number;
    readonly answer: readonly Inline[];
    readonly hint: string | null;
  }
  | { readonly type: "blank"; readonly hint: string | null };

/** A list one level down: its items' lines. */
export type SubList = {
  readonly ordered: boolean;
  readonly items: readonly (readonly Inline[])[];
};

/** An item of a list, with the lists nested under it. */
export type ListItem = {
  readonly content: readonly Inline[];
  readonly sublists: readonly SubList[];
};

/** A block of a document: a paragraph, or a list. */
export type Block =
  | { readonly type: "paragraph"; readonly content: readonly Inline[] }
  | {
    readonly type: "list";
    readonly ordered: boolean;
    readonly items: readonly ListItem[];
  };

/** A parsed text: its blocks, apart by exactly one newline. */
export type Document = readonly Block[];

/** The characters a backslash makes literal wherever it stands. */
const ESCAPABLE = new Set(["\\", "*", "_", "`", "{", "}", ":"]);

/** The longest run of digits a cloze number may have. */
const MAX_NUMBER_DIGITS = 9;

// Rust's `char::is_whitespace` and `is_alphanumeric`, which are Unicode's White_Space, and
// Alphabetic or numeric: not JavaScript's `trim`, which also strips U+FEFF.
const WHITESPACE = /^\p{White_Space}$/u;
const ALPHANUMERIC = /^[\p{Alphabetic}\p{N}]$/u;
const TRIMMED = /^\p{White_Space}+|\p{White_Space}+$/gu;

const trim = (text: string) => text.replace(TRIMMED, "");
const isBlank = (text: string) => trim(text) === "";

function normalizeNewlines(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

/** A character of a text; `lit` when a backslash made it literal, so that no rule sees it. */
type Tok = { readonly ch: string; readonly lit: boolean };

function tokens(text: string): Tok[] {
  const chars = [...text];
  const out: Tok[] = [];
  for (let at = 0; at < chars.length; at++) {
    const ch = chars[at];
    if (ch === undefined) break;
    const next = chars[at + 1];
    if (ch === "\\" && next !== undefined && ESCAPABLE.has(next)) {
      out.push({ ch: next, lit: true });
      at++;
    } else out.push({ ch, lit: false });
  }
  return out;
}

const is = (tok: Tok | undefined, ch: string) =>
  tok !== undefined && !tok.lit && tok.ch === ch;
const isWord = (tok: Tok | undefined) =>
  tok !== undefined && ALPHANUMERIC.test(tok.ch);
const isSpace = (tok: Tok | undefined) =>
  tok !== undefined && WHITESPACE.test(tok.ch);
const same = (a: Tok, b: Tok) => a.ch === b.ch && a.lit === b.lit;
const string = (chars: readonly Tok[]) => chars.map((tok) => tok.ch).join("");
const ascii = (ch: string | undefined) =>
  ch !== undefined && /^[0-9]$/.test(ch);

function runLength(chars: readonly Tok[], at: number): number {
  const first = chars[at];
  if (first === undefined) return 0;
  let length = 0;
  for (;;) {
    const next = chars[at + length];
    if (next === undefined || !same(next, first)) return length;
    length++;
  }
}

/** The index of the backtick closing the code span opened at [open], on the same line. */
function codeEnd(chars: readonly Tok[], open: number): number | null {
  for (let at = open + 1; at < chars.length; at++) {
    if (is(chars[at], "`")) return at > open + 1 ? at : null;
    if (is(chars[at], "\n")) return null;
  }
  return null;
}

/** Whether the run at [at] can open a mark. */
function opens(chars: readonly Tok[], at: number, run: number, ch: string) {
  const next = chars[at + run];
  return next !== undefined && !isSpace(next) &&
    !(ch === "_" && at > 0 && isWord(chars[at - 1]));
}

type ClozeSpan = {
  readonly number: number;
  readonly answer: readonly [number, number];
  readonly hint: readonly [number, number] | null;
  readonly end: number;
};

function pairAt(chars: readonly Tok[], at: number, ch: string): boolean {
  return is(chars[at], ch) && is(chars[at + 1], ch);
}

/** The cloze span starting at [open], if one does. */
function clozeSpan(chars: readonly Tok[], open: number): ClozeSpan | null {
  if (!pairAt(chars, open, "{") || !is(chars[open + 2], "c")) return null;
  const digitsAt = open + 3;
  let digits = 0;
  for (;;) {
    const digit = chars[digitsAt + digits];
    if (digit === undefined || digit.lit || !ascii(digit.ch)) break;
    digits++;
  }
  if (digits === 0 || digits > MAX_NUMBER_DIGITS) return null;
  const number = Number(string(chars.slice(digitsAt, digitsAt + digits)));
  const start = digitsAt + digits + 2;
  if (number === 0 || !pairAt(chars, digitsAt + digits, ":")) return null;
  let end = start;
  while (end < chars.length && !pairAt(chars, end, "}")) end++;
  if (end >= chars.length) return null;
  let split: number | null = null;
  for (let at = start; at < end - 1; at++) {
    if (pairAt(chars, at, ":")) {
      split = at;
      break;
    }
  }
  const answerEnd = split ?? end;
  if (chars.slice(start, answerEnd).every(isSpace)) return null;
  const hint = split !== null && split + 2 < end
    ? [split + 2, end] as const
    : null;
  return { number, answer: [start, answerEnd], hint, end: end + 2 };
}

/** The index of the run closing a mark whose content starts at [from]. */
function closer(
  chars: readonly Tok[],
  from: number,
  ch: string,
  run: number,
  clozeAllowed: boolean,
): number | null {
  let at = from;
  for (;;) {
    const here = chars[at];
    if (here === undefined) return null;
    if (is(here, "`")) {
      const end = codeEnd(chars, at);
      if (end !== null) {
        at = end + 1;
        continue;
      }
    } else if (is(here, "{") && clozeAllowed) {
      const span = clozeSpan(chars, at);
      if (span !== null) {
        at = span.end;
        continue;
      }
    } else if (is(here, ch)) {
      const length = runLength(chars, at);
      const closes = length === run && at > from && !isSpace(chars[at - 1]) &&
        !(ch === "_" && isWord(chars[at + length]));
      if (closes) return at;
      at += length;
      continue;
    }
    at++;
  }
}

/** The inlines of [chars]; recursion is bounded as the engine's is. */
function inlines(chars: readonly Tok[], clozeAllowed: boolean): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text !== "") out.push({ type: "text", text });
    text = "";
  };
  let at = 0;
  for (;;) {
    const tok = chars[at];
    if (tok === undefined) break;
    if (is(tok, "\n")) {
      flush();
      out.push({ type: "lineBreak" });
      at++;
    } else if (is(tok, "`")) {
      const end = codeEnd(chars, at);
      if (end === null) {
        text += "`";
        at++;
      } else {
        flush();
        out.push({ type: "code", text: string(chars.slice(at + 1, end)) });
        at = end + 1;
      }
    } else if (is(tok, "{")) {
      const span = clozeAllowed ? clozeSpan(chars, at) : null;
      if (span === null) {
        text += "{";
        at++;
      } else {
        flush();
        out.push({
          type: "cloze",
          number: span.number,
          answer: inlines(chars.slice(span.answer[0], span.answer[1]), false),
          hint: span.hint === null
            ? null
            : string(chars.slice(span.hint[0], span.hint[1])),
        });
        at = span.end;
      }
    } else if (is(tok, "*") || is(tok, "_")) {
      const ch = tok.ch;
      const run = runLength(chars, at);
      const canMark = (run === 1 || (ch === "*" && run === 2)) &&
        opens(chars, at, run, ch);
      const close = canMark
        ? closer(chars, at + run, ch, run, clozeAllowed)
        : null;
      if (close === null) {
        text += ch.repeat(run);
        at += run;
      } else {
        flush();
        const inner = inlines(chars.slice(at + run, close), clozeAllowed);
        out.push(
          run === 2
            ? { type: "bold", content: inner }
            : { type: "italic", content: inner },
        );
        at = close + run;
      }
    } else {
      text += tok.ch;
      at++;
    }
  }
  flush();
  return out;
}

function parseInlines(text: string): Inline[] {
  return inlines(tokens(text), true);
}

/** Whether [line] starts with `-`, or digits followed by `.`: what an escape at a line's start makes literal. */
function startsList(line: string): boolean {
  let digits = 0;
  while (ascii(line[digits])) digits++;
  return line.startsWith("-") || (digits > 0 && line[digits] === ".");
}

/** The rest of a line that starts with a backslash before a list marker. */
function escapedStart(line: string): string | null {
  if (!line.startsWith("\\")) return null;
  const rest = line.slice(1);
  return startsList(rest) ? rest : null;
}

type Marker = {
  readonly nested: boolean;
  readonly ordered: boolean;
  readonly content: string;
};

/** The marker a line starts with, if any. */
function marker(line: string): Marker | null {
  const body = line.replace(/^[ \t]+/, "");
  const indent = line.length - body.length;
  let nested = true;
  if (indent === 0) nested = false;
  else if (indent === 1 && !line.startsWith("\t")) return null;
  let ordered: boolean;
  let content: string;
  if (body.startsWith("- ")) {
    ordered = false;
    content = body.slice(2);
  } else {
    let digits = 0;
    while (ascii(body[digits])) digits++;
    if (body.slice(digits, digits + 2) !== ". ") return null;
    if (digits === 0 || digits > MAX_NUMBER_DIGITS) return null;
    ordered = true;
    content = body.slice(digits + 2);
  }
  content = trim(content);
  return content === "" ? null : { nested, ordered, content };
}

type MutableItem = { content: Inline[]; sublists: MutableSub[] };
type MutableSub = { ordered: boolean; items: Inline[][] };
type ListBuilder = { ordered: boolean; items: MutableItem[] };

/** Parses [text] into a document. Total: no input is refused. */
export function parseMarkup(text: string): Document {
  const done: Block[] = [];
  let paragraph: string[] = [];
  let list: ListBuilder | null = null;
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      done.push({
        type: "paragraph",
        content: parseInlines(paragraph.join("\n")),
      });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list !== null) {
      done.push({ type: "list", ordered: list.ordered, items: list.items });
      list = null;
    }
  };
  const line = (current: string) => {
    if (isBlank(current)) {
      flushParagraph();
      flushList();
      done.push({
        type: "paragraph",
        content: current === "" ? [] : [{ type: "text", text: current }],
      });
      return;
    }
    const literal = escapedStart(current);
    if (literal !== null) {
      flushList();
      paragraph.push(literal);
      return;
    }
    const mark = marker(current);
    if (mark !== null && !mark.nested) {
      flushParagraph();
      if (list !== null && list.ordered !== mark.ordered) flushList();
      list ??= { ordered: mark.ordered, items: [] };
      list.items.push({ content: parseInlines(mark.content), sublists: [] });
    } else if (mark !== null && list !== null && list.items.length > 0) {
      const content = parseInlines(mark.content);
      const item = list.items[list.items.length - 1];
      const sub = item?.sublists[item.sublists.length - 1];
      if (
        item !== undefined && sub !== undefined && sub.ordered === mark.ordered
      ) {
        sub.items.push(content);
      } else item?.sublists.push({ ordered: mark.ordered, items: [content] });
    } else {
      flushList();
      paragraph.push(current);
    }
  };
  const normal = normalizeNewlines(text);
  if (normal !== "") { for (const one of normal.split("\n")) line(one); }
  flushParagraph();
  flushList();
  return done;
}

function mergeText(items: readonly Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last?.type === "text" && item.type === "text") {
      out[out.length - 1] = { type: "text", text: last.text + item.text };
    } else out.push(item);
  }
  return out;
}

type Replace = (cloze: Extract<Inline, { type: "cloze" }>) => readonly Inline[];

function mapInlines(items: readonly Inline[], replace: Replace): Inline[] {
  const out: Inline[] = [];
  for (const item of items) {
    if (item.type === "cloze") out.push(...replace(item));
    else if (item.type === "bold" || item.type === "italic") {
      out.push({ type: item.type, content: mapInlines(item.content, replace) });
    } else out.push(item);
  }
  return mergeText(out);
}

function mapClozes(document: Document, replace: Replace): Document {
  return document.map((block): Block => {
    if (block.type === "paragraph") {
      return { ...block, content: mapInlines(block.content, replace) };
    }
    return {
      ...block,
      items: block.items.map((item) => ({
        content: mapInlines(item.content, replace),
        sublists: item.sublists.map((sub) => ({
          ordered: sub.ordered,
          items: sub.items.map((line) => mapInlines(line, replace)),
        })),
      })),
    };
  });
}

/** Each inline list of [document]: paragraphs', items' and sub-items' lines, in order. */
function lines(document: Document): (readonly Inline[])[] {
  return document.flatMap((block) =>
    block.type === "paragraph"
      ? [block.content]
      : block.items.flatMap((item) => [
        item.content,
        ...item.sublists.flatMap((sub) => sub.items),
      ])
  );
}

function numbersIn(items: readonly Inline[], found: Set<number>): void {
  for (const item of items) {
    if (item.type === "cloze") found.add(item.number);
    else if (item.type === "bold" || item.type === "italic") {
      numbersIn(item.content, found);
    }
  }
}

/** The cloze numbers [document] holds, ascending, each once. */
export function clozeNumbers(document: Document): number[] {
  const found = new Set<number>();
  for (const line of lines(document)) numbersIn(line, found);
  return [...found].sort((a, b) => a - b);
}

/** [document] with every span of cloze [number] a blank carrying its hint, every other cloze its answer. */
export function hideCloze(document: Document, number: number): Document {
  return mapClozes(
    document,
    (cloze) =>
      cloze.number === number
        ? [{ type: "blank", hint: cloze.hint }]
        : cloze.answer,
  );
}

/** [document] with every cloze shown as its answer. */
export function fillCloze(document: Document): Document {
  return mapClozes(document, (cloze) => cloze.answer);
}

function plain(items: readonly Inline[]): string {
  return items.map((item): string => {
    switch (item.type) {
      case "text":
      case "code":
        return item.text;
      case "lineBreak":
        return "\n";
      case "bold":
      case "italic":
        return plain(item.content);
      case "cloze":
        return plain(item.answer);
      case "blank":
        return "___";
    }
  }).join("");
}

/** The text without marks, clozes filled, for the card key: blocks, items and line breaks a newline apart. */
export function plainText(document: Document): string {
  return document.map((block) =>
    block.type === "paragraph"
      ? plain(block.content)
      : block.items.flatMap((item) => [
        plain(item.content),
        ...item.sublists.flatMap((sub) => sub.items.map(plain)),
      ]).join("\n")
  ).join("\n");
}

/** [text], already normalised, escaped; [lineStart] says whether its first character begins a line. */
function escape(text: string, lineStart: boolean): string {
  return text.split("\n").map((line, index) => {
    const prefix = (index > 0 || lineStart) && startsList(line) ? "\\" : "";
    return prefix +
      [...line].map((ch) => ESCAPABLE.has(ch) ? `\\${ch}` : ch).join("");
  }).join("\n");
}

/** [text] written as markup that reads back as exactly that text, newlines normalised. */
export function escapeLiteral(text: string): string {
  return escape(normalizeNewlines(text), true);
}

/**
 * A version 1 cloze block as a text of this syntax: blank k becomes `{{ck::answer_k}}`, the text and
 * the answers through [escapeLiteral]'s rule. Null when the blanks and answers differ in number, or
 * an answer is empty or has a line of only whitespace.
 */
export function clozeFromV1(
  text: string,
  answers: readonly string[],
): string | null {
  const parts = normalizeNewlines(text).split("___");
  if (parts.length !== answers.length + 1) return null;
  let source = "";
  for (const [index, part] of parts.entries()) {
    source += escape(part, index === 0);
    const answer = answers[index];
    if (answer !== undefined) {
      const normal = normalizeNewlines(answer);
      if (normal.split("\n").some(isBlank)) return null;
      source += `{{c${index + 1}::${escape(normal, false)}}}`;
    }
  }
  return source;
}

/** Whether [document] holds only text and line breaks, in paragraphs. */
function isLiteral(document: Document): boolean {
  return document.every((block) =>
    block.type === "paragraph" &&
    block.content.every((item) =>
      item.type === "text" || item.type === "lineBreak"
    )
  );
}

/**
 * The literal text [markup] reads as, when it holds no mark, list or cloze and writing that text
 * through [escapeLiteral] reads back as the same document; null when no literal text is the same.
 */
export function literalOf(markup: string): string | null {
  const document = parseMarkup(markup);
  if (!isLiteral(document)) return null;
  const text = plainText(document);
  return JSON.stringify(parseMarkup(escapeLiteral(text))) ===
      JSON.stringify(document)
    ? text
    : null;
}

/**
 * The version 1 form of a cloze text of version 2, when one reads as the same document: its
 * clozes numbered 1 to k in order with no hint, mark or list, holding text alone, and the text
 * with `___` for each. Null when none does, and the text stays version 2.
 */
export function clozeToV1(
  source: string,
): { readonly text: string; readonly answers: string[] } | null {
  const document = parseMarkup(source);
  const answers: string[] = [];
  const parts: string[] = [];
  for (const block of document) {
    if (block.type !== "paragraph") return null;
    let line = "";
    for (const item of block.content) {
      if (item.type === "text") line += item.text;
      else if (item.type === "lineBreak") line += "\n";
      else if (
        item.type === "cloze" &&
        item.number === answers.length + 1 && isLiteral([{
          type: "paragraph",
          content: item.answer,
        }])
      ) {
        line += "___";
        answers.push(plain(item.answer));
      } else return null;
    }
    parts.push(line);
  }
  const text = parts.join("\n");
  const written = clozeFromV1(text, answers);
  return answers.length > 0 && written !== null &&
      JSON.stringify(parseMarkup(written)) === JSON.stringify(document)
    ? { text, answers }
    : null;
}

/**
 * How many `{{cN::` openers [text] has that no cloze of its parsed document accounts for: a cloze
 * with no answer, one not closed, or one inside another. Openers escaped or in code do not count.
 */
export function unfinishedClozes(text: string): number {
  const opener = /\{\{c[0-9]+::/g;
  // A character a backslash made literal reads as a placeholder that no opener holds.
  const unescaped = tokens(text).map((tok) => tok.lit ? "\0" : tok.ch).join("");
  const openers = unescaped.match(opener)?.length ?? 0;
  let accounted = 0;
  const count = (items: readonly Inline[]) => {
    for (const item of items) {
      if (item.type === "cloze") accounted++;
      else if (item.type === "code") {
        accounted += item.text.match(opener)?.length ?? 0;
      } else if (item.type === "bold" || item.type === "italic") {
        count(item.content);
      }
    }
  };
  for (const line of lines(parseMarkup(text))) count(line);
  return Math.max(0, openers - accounted);
}
