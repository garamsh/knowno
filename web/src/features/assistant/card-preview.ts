import { documentText, parse, plainText } from "@/design/markup-engine";

/** A proposed card in two lines: what it shows first, and what it adds at the reveal. */
export type CardPreview = { front: string; back: string };

type Fields = Record<string, unknown>;
const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const texts = (value: unknown) => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);

/** [value] as the engine reads it, its marks left out and its clozes filled; the engine must be loaded. */
const markup = (value: unknown) => {
  const written = text(value);
  return written === "" ? "" : plainText(written).trim();
};

/**
 * A cloze of version 2, its text in Anki's syntax: each cloze a blank with its hint after it, and
 * the answers after the reveal.
 */
function clozeMarkup(source: string): CardPreview {
  const document = parse(source);
  const answers: string[] = [];
  const front = documentText(document, (answer, hint) => {
    answers.push(answer);
    return hint === null ? "___" : `___(${hint})`;
  });
  return { front: front.trim(), back: answers.join(", ") };
}

/** A sense as every book reads it: its labels in brackets, then its meaning (ADR 0075). */
function senseLine(value: unknown): string {
  if (!isFields(value)) return "";
  const labels = texts(value.labels).map((label) => `[${label}]`);
  return [...labels, text(value.meaning)].filter(Boolean).join(" ");
}

/** [block]'s part of each line, by its type as `add_cards` reads it. */
function blockLines(block: Fields): CardPreview {
  switch (block.type) {
    case "text":
      return { front: markup(block.front), back: markup(block.back) };
    case "senses":
      return {
        front: text(block.term),
        back: (Array.isArray(block.senses) ? block.senses : []).map(senseLine).join(" · "),
      };
    case "cloze":
      // A cloze of version 2 holds its text alone, in Anki's syntax.
      if (!Array.isArray(block.answers)) return clozeMarkup(text(block.text));
      return {
        front: text(block.text),
        back: (Array.isArray(block.answers) ? block.answers : [])
          .map((answer) => (Array.isArray(answer) ? texts(answer).join("/") : text(answer)))
          .join(", "),
      };
    case "table":
      return {
        front: texts(block.columns).join(" · "),
        back: (Array.isArray(block.rows) ? block.rows : [])
          .map((row) => texts(row).join(" · "))
          .join(" / "),
      };
    case "image":
      return { front: "사진", back: "" };
    default:
      return { front: "", back: "" };
  }
}

/**
 * [card], as `add_cards` or `update_cards` takes it, in two lines: its blocks' first-shown parts
 * joined over what each adds, or the plain front and back with its senses' labels. A text and a
 * cloze of version 2 are read by the engine, so it must be loaded (`useMarkupReady`), and a
 * proposal never shows `{{c1::` or a mark's asterisks.
 */
export function previewOf(card: Fields): CardPreview {
  if (!Array.isArray(card.blocks)) {
    const labels = texts(card.labels).map((label) => `[${label}]`);
    return {
      front: text(card.front),
      back: [...labels, text(card.back)].filter(Boolean).join(" "),
    };
  }
  const lines = card.blocks.filter(isFields).map(blockLines);
  return {
    front: lines
      .map((line) => line.front)
      .filter(Boolean)
      .join(" · "),
    back: lines
      .map((line) => line.back)
      .filter(Boolean)
      .join(" · "),
  };
}
