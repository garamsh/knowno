import type { ReactNode } from "react";

import type { Block, Inline } from "./markup-engine";

/** A cloze span of a document: its number, its answer's runs and its hint. */
export type ClozeSpan = Extract<Inline, { type: "cloze" }>;

/**
 * [content], a cloze span's answer or any inline runs, as spans of text with their marks, each
 * cloze inside drawn as its answer.
 */
export function MarkupRuns({ content }: { content: Inline[] }) {
  return runs(content, filled);
}

function runs(content: Inline[], cloze: (span: ClozeSpan) => ReactNode): ReactNode[] {
  return content.map((run, index) => {
    switch (run.type) {
      case "text":
        return run.text;
      case "lineBreak":
        return <br key={index} />;
      case "bold":
        return <strong key={index}>{runs(run.content, cloze)}</strong>;
      case "italic":
        return <em key={index}>{runs(run.content, cloze)}</em>;
      case "code":
        return (
          <code key={index} className="rounded-sm bg-raised px-1 font-mono">
            {run.text}
          </code>
        );
      case "cloze":
        return <span key={index}>{cloze(run)}</span>;
      case "blank":
        return <span key={index}>___</span>;
    }
  });
}

// The phone's markers. They are written as escapes because `jua_coverage_test.dart` reads the
// web's source for characters outside Jua's face, and these two are drawn by the fallback.
const bullet = "\u2022 ";
const nestedBullet = "\u25E6 ";

/** A cloze drawn as its answer, filled in. */
function filled(span: ClozeSpan): ReactNode {
  return runs(span.answer, filled);
}

/**
 * A card text's [document] as the engine read it: each block on a line after the last, with no
 * space between them (ADR 0208), a list item on a line of its own after its marker, a bullet or its
 * number, and a nested item two spaces further in under a small bullet or its number. An empty paragraph is
 * an empty line. Marks are bold, italic and code; [cloze] draws each cloze span, its answer filled
 * in where it is not given. It is spans throughout, so a button can hold it, and it holds no
 * client code, so a server draws it.
 */
export function MarkupText({
  document,
  cloze = filled,
}: {
  document: Block[];
  cloze?: (span: ClozeSpan) => ReactNode;
}) {
  return document.flatMap((block, index) => {
    if (block.type === "paragraph") {
      return [
        <span key={index} data-markup="paragraph" className="block min-h-lh whitespace-pre-wrap">
          {runs(block.content, cloze)}
        </span>,
      ];
    }
    const marker = (at: number) => (block.ordered ? `${String(at + 1)}. ` : bullet);
    return block.items.flatMap((item, at) => [
      <span
        key={`${String(index)}-${String(at)}`}
        data-markup="item"
        className="block whitespace-pre-wrap"
      >
        {marker(at)}
        {runs(item.content, cloze)}
      </span>,
      ...item.sublists.flatMap((sub, subAt) =>
        sub.items.map((line, lineAt) => (
          <span
            key={`${String(index)}-${String(at)}-${String(subAt)}-${String(lineAt)}`}
            data-markup="subitem"
            className="block whitespace-pre-wrap"
          >
            {"  "}
            {sub.ordered ? `${String(lineAt + 1)}. ` : nestedBullet}
            {runs(line, cloze)}
          </span>
        )),
      ),
    ]);
  });
}
