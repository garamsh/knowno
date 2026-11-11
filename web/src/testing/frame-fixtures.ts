import { escapeLiteral } from "@/design/markup-engine";

type Stored = { type: string; v?: number; payload: Record<string, unknown> };

const isBlock = (value: unknown): value is Stored =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  typeof value.type === "string" &&
  "payload" in value &&
  typeof value.payload === "object" &&
  value.payload !== null;

const isCandidate = (
  value: unknown,
): value is { type: "cloze"; front: string; cloze: { answers: unknown[] } } =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  value.type === "cloze" &&
  "front" in value &&
  typeof value.front === "string" &&
  "cloze" in value &&
  typeof value.cloze === "object" &&
  value.cloze !== null &&
  "answers" in value.cloze &&
  Array.isArray(value.cloze.answers);

/** A version 1 cloze's [text] and [answers] as Anki's syntax, each part escaped as literal text. */
function clozeSource(text: string, answers: (string | string[] | undefined)[]): string {
  const parts = text.split("___");
  return parts.reduce((source, part, at) => {
    const answer = answers[at];
    const filled =
      answer === undefined
        ? ""
        : `{{c${String(at)}::${escapeLiteral(Array.isArray(answer) ? answer.join("/") : answer)}}}`;
    return `${source}${at === 0 ? "" : filled}${escapeLiteral(part)}`;
  }, "");
}

/**
 * [value] with every `text` and `cloze` block of an earlier form written as the form this build
 * reads: `text` of versions 1 and 2 as version 3, its fields as markup that reads back as the
 * same words, and a version 1 cloze as version 2. A 글 under `cells` or `saved` is one of a list of 칸. The shared fixtures under
 * `supabase/fixtures/card-frame/` hold the earlier forms, which the phone still writes.
 */
export function inCurrentForms(value: unknown, framed = false): unknown {
  if (Array.isArray(value)) return value.map((item) => inCurrentForms(item, framed));
  if (typeof value !== "object" || value === null) return value;
  if (isCandidate(value)) {
    // A photo's cloze card as the function now sends it: its front in Anki's syntax, no answers.
    const { cloze, ...card } = value;
    return {
      ...card,
      front: clozeSource(value.front, [undefined, ...(cloze.answers as (string | string[])[])]),
    };
  }
  if (isBlock(value)) {
    const { type, payload, v } = value;
    const rest = Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "payload" && key !== "v"),
    );
    if (type === "text" && (v === undefined || v === 1) && typeof payload.text === "string") {
      // In a list of 칸 a 글 holds a front and a back; on a side it holds its text alone.
      const text = escapeLiteral(payload.text);
      return { ...rest, v: 3, payload: framed ? { front: text, back: "" } : { text } };
    }
    if (type === "text" && v === 2) {
      return {
        ...rest,
        v: 3,
        payload: {
          front: escapeLiteral(String(payload.front)),
          back: escapeLiteral(String(payload.back)),
        },
      };
    }
    if (
      type === "cloze" &&
      (v === undefined || v === 1) &&
      typeof payload.text === "string" &&
      Array.isArray(payload.answers)
    ) {
      const answers = payload.answers as (string | string[])[];
      // The numbers start at 1: the first blank is `c1`.
      const text = clozeSource(payload.text, [undefined, ...answers]);
      return { ...rest, v: 2, payload: { text } };
    }
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [
      key,
      inCurrentForms(field, framed || key === "cells" || key === "saved"),
    ]),
  );
}
