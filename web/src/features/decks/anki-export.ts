import { type Cell, describeContent, type Content } from "./card-content";
import type { Card } from "./library";
import { type Inline, parse } from "@/design/markup-engine";

/** The notes of a note as Anki's "Notes in Plain Text" file, and how many cards each way became. */
export type AnkiNotes = {
  text: string;
  /** Cards written as Basic notes, a 글 or what could be read as one. */
  basic: number;
  /** Cards written as Cloze notes. */
  cloze: number;
  /** Of the Basic notes, those made from a card that is not a 글: its text, on the sides it shows it. */
  flattened: number;
  /** Cards with no text to write, left out. */
  skipped: number;
};

/** Anki's stock note type names, which its import matches by name (ADR 0222). */
const basicType = "Basic";
const clozeType = "Cloze";

const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

/** [text] as HTML text: no `{` or `}`, so it never reads as a cloze in Anki, and `:` too inside one. */
function htmlText(text: string, inCloze: boolean): string {
  return text.replace(/[&<>{}:]/gu, (char) => {
    if (char === ":") return inCloze ? "&#58;" : ":";
    return escapes[char] ?? `&#${String(char.charCodeAt(0))};`;
  });
}

function runsHtml(runs: Inline[], inCloze = false): string {
  return runs
    .map((run) => {
      switch (run.type) {
        case "text":
          return htmlText(run.text, inCloze);
        case "code":
          return `<code>${htmlText(run.text, inCloze)}</code>`;
        case "lineBreak":
          return "<br>";
        case "bold":
          return `<b>${runsHtml(run.content, inCloze)}</b>`;
        case "italic":
          return `<i>${runsHtml(run.content, inCloze)}</i>`;
        case "cloze":
          return `{{c${String(run.number)}::${runsHtml(run.answer, true)}${
            run.hint === null ? "" : `::${htmlText(run.hint, true)}`
          }}}`;
        case "blank":
          return "___";
      }
    })
    .join("");
}

/** A card text's markup as the HTML Anki's fields hold: lines apart by `<br>`, lists as lists. */
export function markupHtml(markup: string): string {
  let html = "";
  let before: "line" | "list" | null = null;
  for (const block of parse(markup)) {
    if (block.type === "paragraph") {
      html += `${before === "line" ? "<br>" : ""}${runsHtml(block.content)}`;
      before = "line";
    } else {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items
        .map(
          ({ content, sublists }) =>
            `<li>${runsHtml(content)}${sublists
              .map((sub) => {
                const inner = sub.ordered ? "ol" : "ul";
                return `<${inner}>${sub.items.map((item) => `<li>${runsHtml(item)}</li>`).join("")}</${inner}>`;
              })
              .join("")}</li>`,
        )
        .join("");
      // A list is a block element, so a break beside it would add a line the text does not have.
      html += `<${tag}>${items}</${tag}>`;
      before = "list";
    }
  }
  return html;
}

/** A plain text as HTML: written as typed, its lines apart by `<br>`. */
export function literalHtml(text: string): string {
  return htmlText(text.replace(/\r\n?/gu, "\n"), false).replaceAll("\n", "<br>");
}

/** The text a side shows, as HTML, where it is not a 글 or a cloze: photos and sounds have none. */
function sideHtml(blocks: Content[]): string {
  return literalHtml(
    describeContent(
      blocks.filter(({ kind }) => kind !== "image" && kind !== "audio" && kind !== "unsupported"),
    ),
  );
}

type Note = { type: string; fields: [string, string]; flattened: boolean };

function noteOf(card: Card): Note | null {
  const [only, ...rest] = card.cells;
  if (only && rest.length === 0) {
    const note = noteOfCell(only);
    if (note) return note;
  }
  return { type: basicType, fields: [sideHtml(card.front), sideHtml(card.back)], flattened: true };
}

function noteOfCell(cell: Cell): Note | null {
  if (cell.kind === "text") {
    const fields: [string, string] = [markupHtml(cell.front), markupHtml(cell.back)];
    return { type: basicType, fields, flattened: false };
  }
  if (cell.kind === "blank" && cell.block.kind === "cloze") {
    return { type: clozeType, fields: [markupHtml(cell.block.text), ""], flattened: false };
  }
  return null;
}

/** A field as Anki's file reads it: quoted, its quotes doubled, where it holds a tab, a quote or a line break. */
function field(value: string): string {
  return /["\t\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Anki reads `::` in a deck name as a sub-deck, so a note's name is not allowed to hold it. */
function deckName(name: string): string {
  return name.replace(/\s+/gu, " ").replace(/:{2,}/gu, ":").trim();
}

/**
 * [cards] of the note [name] as Anki's "Notes in Plain Text" file (ADR 0222): tab-separated HTML
 * with the note type in column 1 and the deck in column 2, so Anki shows each card as a Basic or a
 * Cloze note in a deck of the note's name. A card whose front has no text is left out.
 */
export function ankiNotes(name: string, cards: Card[]): AnkiNotes {
  const result: AnkiNotes = { text: "", basic: 0, cloze: 0, flattened: 0, skipped: 0 };
  const deck = deckName(name) || "knowno";
  const lines = ["#separator:tab", "#html:true", "#notetype column:1", "#deck column:2"];
  for (const card of cards) {
    const note = noteOf(card);
    if (!note || note.fields[0] === "") {
      result.skipped += 1;
      continue;
    }
    if (note.type === clozeType) result.cloze += 1;
    else result.basic += 1;
    if (note.flattened) result.flattened += 1;
    lines.push([note.type, deck, ...note.fields].map(field).join("\t"));
  }
  result.text = `${lines.join("\n")}\n`;
  return result;
}
