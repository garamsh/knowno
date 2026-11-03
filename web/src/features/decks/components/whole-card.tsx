import type { ReactNode } from "react";

import {
  audioLength,
  type Cell,
  type CellPart,
  type Content,
  cellRuns,
  clozeBlank,
  describeContent,
  shownParts,
  spokenContent,
} from "../card-content";
import { PhotoFrame } from "./photo-frame";
import { SensesText } from "./side-text";

/**
 * A whole card's front, its blocks in order: a text block as its title, a cloze as its sentence,
 * a table as its table and a photo as its frame with its boxes, with each blank empty, or filled
 * in place when [revealed] (ADR 0068, ADR 0109), a table's span inside its cell's text
 * (ADR 0110), and a sound as "소리" and its length, which the study page's controls play
 * (ADR 0112). An empty blank keeps its answer's width, so filling it moves nothing. It reads as
 * `spokenContent` says, blanks as "빈칸" until revealed. It is spans throughout, so a button can
 * hold it. Centred, its text block in the headline, as a card draws it; [inRow], from the start,
 * in a list row's style in bold (ADR 0119).
 */
export function WholeCard({
  blocks,
  revealed,
  inRow = false,
}: {
  blocks: Content[];
  revealed: boolean;
  inRow?: boolean;
}) {
  const parts = blocks.map((block) => ({ block, added: false }));
  return <WholeParts parts={parts} revealed={revealed} inRow={inRow} />;
}

/**
 * A card of [cells] drawn whole, each 칸 in place (ADR 0137): before the reveal a 글's front as
 * its title, a 단어's asked side, each blank empty and a front photo or sound, a 칸 with nothing
 * before it drawing nothing; [revealed], every 칸 revealed, a blank filled, an added part under
 * its first part at the back's size and colour, and a back photo or sound in its place.
 * [studied], as study's cards draw it (#635): each empty blank, a table's hidden cell included, a
 * box on the hatch [blankEms] wide at its line's height whatever its answer, a filled one its
 * answer on the hatch, and each photo's box on the hatch, its answer on it once revealed.
 */
export function WholeCells({
  cells,
  revealed,
  inRow = false,
  studied = false,
}: {
  cells: Cell[];
  revealed: boolean;
  inRow?: boolean;
  studied?: boolean;
}) {
  return (
    <WholeParts
      parts={shownParts(cells, revealed)}
      revealed={revealed}
      inRow={inRow}
      look={studied ? "studied" : "card"}
    />
  );
}

/**
 * A card of [cells] as a note's card list draws it (#629): in a row's style, every 칸 revealed,
 * and what study hides until the reveal on the hatch: each blank, each photo's box, and each
 * added part in a hatched box. A shown part is cut at two lines and an added one at three, and a
 * table shows its first [listedRows] rows and how many it leaves.
 */
export function ListedCells({ cells }: { cells: Cell[] }) {
  return <WholeParts parts={shownParts(cells, true)} revealed inRow look="listed" />;
}

/**
 * How a whole card is drawn: as the card editor draws a card, as study's cards (#635), or as a
 * card list's row (#629).
 */
type Look = "card" | "studied" | "listed";

/** How wide an empty blank's box is on study's cards, in ems of its text (#635). */
export const blankEms = 2;

/**
 * How long a front of [blocks] reads, in characters: its text, each blank counted as [blankEms],
 * its box's width, as the phone's `faceLength` (#635).
 */
export function faceLength(blocks: Content[]): number {
  return blocks.reduce((sum, block) => {
    switch (block.kind) {
      case "text":
        return sum + block.text.length;
      case "senses":
        return sum + describeContent([block]).length;
      case "cloze":
        return sum + block.text.split(clozeBlank).join("").length + block.answers.length * blankEms;
      case "table":
        return (
          sum +
          block.columns.join("").length +
          block.rows
            .flatMap((cells, row) => cells.flatMap((_, column) => cellRuns(block, row, column)))
            .reduce((length, run) => length + (run.blank ? blankEms : run.text.length), 0)
        );
      case "image":
      case "audio":
      case "unsupported":
        return sum;
    }
  }, 0);
}

/** The rows of a table a card list's row shows. */
const listedRows = 3;

/** [children] in a box on the hatch, cut at three lines, as a card list marks a revealed part. */
export function HatchedBox({ children }: { children: ReactNode }) {
  return (
    <span data-hatched className="hatch block rounded-chip px-3 py-2">
      <span className="line-clamp-3 break-keep">{children}</span>
    </span>
  );
}

function WholeParts({
  parts,
  revealed,
  inRow,
  look = "card",
}: {
  parts: CellPart[];
  revealed: boolean;
  inRow: boolean;
  look?: Look;
}) {
  const listed = look === "listed";
  const addedStyle = inRow ? "font-normal text-ink-2" : "text-whole-added text-ink-2";
  /** A part of a card list's row: an added one in a hatched box, a shown one cut at two lines. */
  const listedPart = (index: number, added: boolean, children: ReactNode) =>
    added ? (
      <span key={index} aria-hidden className={addedStyle}>
        <HatchedBox>{children}</HatchedBox>
      </span>
    ) : (
      <span key={index} aria-hidden className="line-clamp-2 break-keep">
        {children}
      </span>
    );
  return (
    <span
      role="group"
      aria-label={spokenContent(
        parts.map(({ block }) => block),
        revealed,
      )}
      className={`flex w-full flex-col ${listed ? "gap-2" : "gap-3"} break-words whitespace-pre-wrap ${inRow ? "text-left text-body-strong" : "text-center"}`}
    >
      {parts.map(({ block, added }, index) => {
        if (listed && block.kind === "text") return listedPart(index, added, block.text);
        if (listed && block.kind === "senses") {
          return listedPart(index, added, <SensesText senses={block.senses} />);
        }
        if (listed && block.kind === "image") {
          const answers = block.boxes
            .map((box) => box.answer?.trim() ?? "")
            .filter((answer) => answer !== "");
          return (
            <span key={index} aria-hidden className="flex flex-col gap-2">
              <PhotoFrame image={block} revealed marked />
              {answers.length > 0 && (
                <span className={addedStyle}>
                  <HatchedBox>{answers.join(" · ")}</HatchedBox>
                </span>
              )}
            </span>
          );
        }
        switch (block.kind) {
          case "text":
            return (
              <span
                key={index}
                aria-hidden
                className={added ? addedStyle : inRow ? "" : "text-whole-front"}
              >
                {block.text}
              </span>
            );
          case "cloze":
            return (
              <span key={index} aria-hidden className={listed ? "line-clamp-2 break-keep" : ""}>
                {look === "studied" && !revealed
                  ? boxedWords(block.text.split(clozeBlank))
                  : block.text.split(clozeBlank).map((part, at) => (
                      <span key={at}>
                        {part}
                        {at < block.answers.length && (
                          <Blank answer={block.answers[at] ?? ""} revealed={revealed} look={look} />
                        )}
                      </span>
                    ))}
              </span>
            );
          case "table": {
            // A card list's row shows a table's first rows and how many it leaves.
            const rows = listed ? block.rows.slice(0, listedRows) : block.rows;
            const left = block.rows.length - rows.length;
            const grid = (
              <span
                key={index}
                aria-hidden
                data-table
                className="grid border-t border-l border-outline text-body"
                style={{ gridTemplateColumns: `repeat(${String(block.columns.length)}, auto)` }}
              >
                {block.columns.map((cell, column) => (
                  <span
                    key={`h-${String(column)}`}
                    className="border-r border-b border-outline bg-ground px-2 py-1 font-bold"
                  >
                    {cell}
                  </span>
                ))}
                {rows.flatMap((cells, row) =>
                  cells.map((_, column) => (
                    <span
                      key={`${String(row)}-${String(column)}`}
                      className={`border-r border-b border-outline px-2 py-1 ${column === 0 ? "font-bold" : ""}`}
                    >
                      {cellRuns(block, row, column).map((run, at) =>
                        run.blank ? (
                          <Blank key={at} answer={run.text} revealed={revealed} look={look} />
                        ) : (
                          <span key={at}>{run.text}</span>
                        ),
                      )}
                    </span>
                  )),
                )}
              </span>
            );
            if (left === 0) return grid;
            return (
              <span key={index} className="flex flex-col gap-1">
                {grid}
                <span aria-hidden className="text-caption font-normal text-ink-2">
                  외 {left}행
                </span>
              </span>
            );
          }
          case "senses":
            return (
              <span key={index} aria-hidden className={added ? addedStyle : ""}>
                <SensesText senses={block.senses} />
              </span>
            );
          case "image":
            return (
              <PhotoFrame
                key={index}
                image={block}
                revealed={revealed}
                studied={look === "studied"}
              />
            );
          case "audio":
            return (
              <span
                key={index}
                aria-hidden
                data-audio={block.media}
                className="text-body text-muted"
              >
                소리 {audioLength(block.durationMs)}
              </span>
            );
          case "unsupported":
            return (
              <span key={index} aria-hidden className="text-body text-muted italic">
                [이 버전에서 표시할 수 없는 내용: {block.type}]
              </span>
            );
        }
      })}
    </span>
  );
}

/**
 * A sentence of [parts] with an empty blank's box between each two, as study's cards draw it
 * (#635): each box on one line with the word or punctuation it touches, so a box and its comma
 * never part. A browser breaks a line beside a box whatever joiner the text holds there.
 */
function boxedWords(parts: string[]): ReactNode[] {
  const words: ReactNode[] = [];
  let word: ReactNode[] = [];
  let boxed = false;
  const close = () => {
    if (word.length === 0) return;
    words.push(
      boxed ? (
        <span key={words.length} className="whitespace-nowrap">
          {word}
        </span>
      ) : (
        word
      ),
    );
    word = [];
    boxed = false;
  };
  parts.forEach((part, at) => {
    for (const piece of part.split(/(\s+)/)) {
      if (piece === "") continue;
      if (/^\s+$/.test(piece)) {
        close();
        words.push(piece);
      } else {
        word.push(piece);
      }
    }
    if (at < parts.length - 1) {
      word.push(<Blank key={`box ${String(at)}`} answer="" revealed={false} look="studied" />);
      boxed = true;
    }
  });
  close();
  return words;
}

/**
 * A blank: an empty gap of its answer's width over a muted underline, its answer not drawn, so
 * hidden content shows as nothing (ADR 0119); or its answer filled on the brand tint. In a card
 * list's row it is filled on the hatch (#629). On study's cards it is a box on the hatch
 * [blankEms] wide at its line's height, its answer not in it, or its answer filled on the hatch
 * (#635).
 */
function Blank({ answer, revealed, look }: { answer: string; revealed: boolean; look: Look }) {
  if (look === "studied" && !revealed) {
    return (
      <span
        data-blank="boxed"
        className="hatch inline-block h-[calc(1lh-var(--spacing))] rounded-sm align-middle"
        style={{ width: `${String(blankEms)}em` }}
      />
    );
  }
  return (
    <span
      data-blank={look === "card" ? (revealed ? "filled" : "empty") : "marked"}
      className={`rounded-sm px-1 ${look === "card" ? (revealed ? "bg-brand-tint" : "text-transparent underline decoration-muted") : "hatch"}`}
    >
      {answer}
    </span>
  );
}
