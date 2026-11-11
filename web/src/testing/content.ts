import { markedOf } from "@/design/markup-engine";
import type { Content } from "@/features/decks";

/** A text block of card content reading [text] as markup, as a stored `text` block v3 does. */
export function textContent(text: string): Extract<Content, { kind: "text" }> {
  return { kind: "text", text, markup: markedOf(text) };
}

/** A cloze block of card content reading [text] as Anki syntax, as a stored `cloze` block v2 does. */
export function clozeContent(text: string): Extract<Content, { kind: "cloze" }> {
  return { kind: "cloze", text, markup: markedOf(text) };
}
