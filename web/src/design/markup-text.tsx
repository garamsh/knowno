import { Fragment, type ReactNode } from "react";

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

function runs(
  content: Inline[],
  cloze: (span: ClozeSpan) => ReactNode,
  joined = false,
): ReactNode[] {
  if (joined) return joinedRuns(content, cloze);
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

type Mark = "bold" | "italic";

/** One word, space or cloze box of a paragraph's runs, with the marks around it. */
type Piece = { marks: Mark[]; node: ReactNode; kind: "word" | "space" | "box" };

function pieces(content: Inline[], cloze: (span: ClozeSpan) => ReactNode, marks: Mark[]): Piece[] {
  return content.flatMap((run, index): Piece[] => {
    switch (run.type) {
      case "text":
        return run.text
          .split(/(\s+)/)
          .filter((text) => text !== "")
          .map((text) => ({ marks, node: text, kind: /^\s+$/.test(text) ? "space" : "word" }));
      case "lineBreak":
        return [{ marks, node: <br />, kind: "space" }];
      case "bold":
        return pieces(run.content, cloze, [...marks, "bold"]);
      case "italic":
        return pieces(run.content, cloze, [...marks, "italic"]);
      case "code":
        return [
          {
            marks,
            node: <code className="rounded-sm bg-raised px-1 font-mono">{run.text}</code>,
            kind: "word",
          },
        ];
      case "cloze":
        return [{ marks, node: <span key={index}>{cloze(run)}</span>, kind: "box" }];
      case "blank":
        return [{ marks, node: <span>___</span>, kind: "word" }];
    }
  });
}

/**
 * [content] with each cloze box kept on one line with the non-space text it touches, as study's
 * cards draw an empty blank (#635): a browser breaks a line beside a box whatever joiner the text
 * holds there, so each word holding a box is one `whitespace-nowrap` unit, its bold and italic
 * marks kept around each piece inside it.
 */
function joinedRuns(content: Inline[], cloze: (span: ClozeSpan) => ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  let word: ReactNode[] = [];
  let boxed = false;
  const draw = ({ marks, node }: Piece, key: number): ReactNode => (
    <Fragment key={key}>
      {marks.reduceRight<ReactNode>(
        (inner, mark) => (mark === "bold" ? <strong>{inner}</strong> : <em>{inner}</em>),
        node,
      )}
    </Fragment>
  );
  const close = () => {
    if (word.length > 0) {
      out.push(
        boxed ? (
          <span key={out.length} className="whitespace-nowrap">
            {word}
          </span>
        ) : (
          <Fragment key={out.length}>{word}</Fragment>
        ),
      );
    }
    word = [];
    boxed = false;
  };
  pieces(content, cloze, []).forEach((piece, at) => {
    if (piece.kind === "space") {
      close();
      out.push(draw(piece, out.length));
      return;
    }
    word.push(draw(piece, at));
    boxed ||= piece.kind === "box";
  });
  close();
  return out;
}

const bullet = "• ";
const nestedBullet = "◦ ";

/** A cloze drawn as its answer, filled in. */
function filled(span: ClozeSpan): ReactNode {
  return runs(span.answer, filled);
}

/**
 * A card text's [document] as the engine read it: each block on a line after the last, with no
 * space between them (ADR 0208), a list item on a line of its own after its marker, a bullet or its
 * number, and a nested item two spaces further in under a small bullet or its number. An empty paragraph is
 * an empty line. Marks are bold, italic and code; [cloze] draws each cloze span, its answer filled
 * in where it is not given, and [joined] keeps each box on one line with the text it touches. It is spans throughout, so a button can hold it, and it holds no
 * client code, so a server draws it.
 */
export function MarkupText({
  document,
  cloze = filled,
  joined = false,
}: {
  document: Block[];
  cloze?: (span: ClozeSpan) => ReactNode;
  joined?: boolean;
}) {
  return document.flatMap((block, index) => {
    if (block.type === "paragraph") {
      return [
        <span key={index} data-markup="paragraph" className="block min-h-lh whitespace-pre-wrap">
          {runs(block.content, cloze, joined)}
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
        {runs(item.content, cloze, joined)}
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
            {runs(line, cloze, joined)}
          </span>
        )),
      ),
    ]);
  });
}
