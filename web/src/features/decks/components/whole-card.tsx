import {
  audioLength,
  type Cell,
  type CellPart,
  type Content,
  cellRuns,
  clozeBlank,
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
 */
export function WholeCells({
  cells,
  revealed,
  inRow = false,
}: {
  cells: Cell[];
  revealed: boolean;
  inRow?: boolean;
}) {
  return <WholeParts parts={shownParts(cells, revealed)} revealed={revealed} inRow={inRow} />;
}

function WholeParts({
  parts,
  revealed,
  inRow,
}: {
  parts: CellPart[];
  revealed: boolean;
  inRow: boolean;
}) {
  const addedStyle = inRow ? "font-normal text-ink-2" : "text-whole-added text-ink-2";
  return (
    <span
      role="group"
      aria-label={spokenContent(
        parts.map(({ block }) => block),
        revealed,
      )}
      className={`flex w-full flex-col gap-3 break-words whitespace-pre-wrap ${inRow ? "text-left text-body-strong" : "text-center"}`}
    >
      {parts.map(({ block, added }, index) => {
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
              <span key={index} aria-hidden>
                {block.text.split(clozeBlank).map((part, at) => (
                  <span key={at}>
                    {part}
                    {at < block.answers.length && (
                      <Blank answer={block.answers[at] ?? ""} revealed={revealed} />
                    )}
                  </span>
                ))}
              </span>
            );
          case "table":
            return (
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
                {block.rows.flatMap((cells, row) =>
                  cells.map((_, column) => (
                    <span
                      key={`${String(row)}-${String(column)}`}
                      className={`border-r border-b border-outline px-2 py-1 ${column === 0 ? "font-bold" : ""}`}
                    >
                      {cellRuns(block, row, column).map((run, at) =>
                        run.blank ? (
                          <Blank key={at} answer={run.text} revealed={revealed} />
                        ) : (
                          <span key={at}>{run.text}</span>
                        ),
                      )}
                    </span>
                  )),
                )}
              </span>
            );
          case "senses":
            return (
              <span key={index} aria-hidden className={added ? addedStyle : ""}>
                <SensesText senses={block.senses} />
              </span>
            );
          case "image":
            return <PhotoFrame key={index} image={block} revealed={revealed} />;
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
 * A blank: an empty gap of its answer's width over a muted underline, its answer not drawn, so
 * hidden content shows as nothing (ADR 0119); or its answer filled on the brand tint.
 */
function Blank({ answer, revealed }: { answer: string; revealed: boolean }) {
  return (
    <span
      data-blank={revealed ? "filled" : "empty"}
      className={`rounded-sm px-1 ${revealed ? "bg-brand-tint" : "text-transparent underline decoration-muted"}`}
    >
      {answer}
    </span>
  );
}
