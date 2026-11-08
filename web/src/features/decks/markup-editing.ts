import { clozeNumbers, parse } from "@/design/markup-engine";

/** A text after an edit, with the selection it leaves. */
export type Edit = { text: string; start: number; end: number };

/** The smallest cloze number from 1 that [text] does not hold: the next free one, read by the engine. */
export function nextClozeNumber(text: string): number {
  const used = new Set(clozeNumbers(text));
  let number = 1;
  while (used.has(number)) number++;
  return number;
}

/**
 * [text] with the selection from [start] to [end] made a cloze of the next free number,
 * `{{cN::selection}}`; a cursor with nothing selected becomes `{{cN::}}` with the cursor inside,
 * which reads as a cloze once an answer is typed.
 */
export function hideSelection(text: string, start: number, end: number): Edit {
  const open = `{{c${String(nextClozeNumber(text))}::`;
  const chosen = text.slice(start, end);
  const inner = start + open.length;
  return {
    text: `${text.slice(0, start)}${open}${chosen}}}${text.slice(end)}`,
    start: inner,
    end: inner + chosen.length,
  };
}

/** A cloze of a text: the characters it spans, and its answer as written. */
export type ClozeAt = { start: number; end: number; answer: string };

/**
 * The cloze of [text] the selection from [start] to [end] is in, which "가리기" offers to remove;
 * null where it is in none. The delimiters around the selection are found by scanning, and the
 * engine decides that they hold exactly one cloze.
 */
export function clozeAt(text: string, start: number, end: number): ClozeAt | null {
  const open = text.lastIndexOf("{{c", start);
  if (open < 0) return null;
  const close = text.indexOf("}}", open);
  if (close < 0 || end > close + 2) return null;
  const found = text.slice(open, close + 2);
  const [only, ...others] = parse(found);
  const [run, ...more] = only?.type === "paragraph" ? only.content : [];
  if (others.length > 0 || more.length > 0 || run?.type !== "cloze") return null;
  const inner = found.slice(found.indexOf("::") + 2, -2);
  return { start: open, end: close + 2, answer: inner.split("::")[0] ?? "" };
}

/** [text] with the cloze [at] turned back into its answer, the cursor after it. */
export function removeCloze(text: string, at: ClozeAt): Edit {
  const cursor = at.start + at.answer.length;
  return {
    text: `${text.slice(0, at.start)}${at.answer}${text.slice(at.end)}`,
    start: cursor,
    end: cursor,
  };
}

const item = /^(\s*)(-|\d+\.) (.*)$/u;

/**
 * What a line break typed at [caret] does to a list, as the phone's `ListContinuation`: at the end
 * of an item, `- text` or `1. text`, it starts the next item, and in an empty item it ends the
 * list. Null where the caret is in no item, so the break is typed as it is.
 */
export function continueList(text: string, caret: number): Edit | null {
  const before = text.slice(0, caret);
  const lineStart = before.lastIndexOf("\n") + 1;
  const match = item.exec(before.slice(lineStart));
  if (!match) return null;
  const after = text.slice(caret);
  if (match[3] === "") {
    // An empty item ends the list: its marker goes and the line is empty.
    return {
      text: `${before.slice(0, lineStart)}\n${after}`,
      start: lineStart + 1,
      end: lineStart + 1,
    };
  }
  const marker = match[2] ?? "-";
  const next = marker === "-" ? "-" : `${String(Number.parseInt(marker, 10) + 1)}.`;
  const inserted = `\n${match[1] ?? ""}${next} `;
  const cursor = before.length + inserted.length;
  return { text: `${before}${inserted}${after}`, start: cursor, end: cursor };
}
