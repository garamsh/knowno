import { escapeLiteral } from "@/design/markup-engine";
import { type CellsDraft, encodeCells, labelsFromText, type WrittenCell } from "./authoring";
import { textCell } from "./card-content";
import type { SheetRow } from "./spreadsheet";

/** The most characters, in code points, a cell filling a card field may hold (ADR 0125). */
export const cellLimit = 500;

/** Which column, from 0, fills each field; a label or example column is optional. */
export type Columns = { front: number; back: number; label: number | null; example: number | null };
/** A sheet row's card, named by the row it came from. */
export type RowCard = CellsDraft & { row: number };
/** The cards a sheet's rows make, and the rows that make none: skipped as empty, or refused as too long. */
export type SheetCards = { cards: RowCard[]; skipped: number[]; tooLong: number[] };

/** Column names that mark a first row as a header, compared trimmed, NFKC-normalized and case-folded. */
const headerNames = new Set([
  "단어",
  "뜻",
  "의미",
  "앞면",
  "뒷면",
  "라벨",
  "예문",
  "품사",
  "front",
  "back",
  "word",
  "term",
  "meaning",
  "definition",
  "example",
  "label",
]);

/**
 * Whether the first row reads as a header by default: the sheet has another row, and either a
 * first-row cell is a common column name, or a first-row cell of text heads a column whose
 * non-empty cells below are all numbers, dates or other values that are not text. Otherwise
 * the first row is a card.
 */
export function headerByDefault(rows: SheetRow[]): boolean {
  const [first, ...below] = rows;
  if (!first || below.length === 0) return false;
  return first.cells.some((cell, column) => {
    if (cell.text === "" || !cell.isText) return false;
    if (headerNames.has(cell.text.normalize("NFKC").trim().toLowerCase())) return true;
    const values = below.flatMap((row) => {
      const under = row.cells[column];
      return under && under.text !== "" ? [under] : [];
    });
    return values.length > 0 && values.every((under) => !under.isText);
  });
}

/** A row's 단어 of one meaning, asking its word. */
function word(term: string, meaning: string, label: string, example: string): WrittenCell {
  const examples = example
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    kind: "word",
    term,
    senses: [{ labels: labelsFromText(label), meaning, examples }],
    ask: "term",
  };
}

/**
 * The cards of [rows] under [columns], each its stored 칸: a row with an empty front or back is
 * skipped, and one whose used cell is longer than [cellLimit] refused. A row is a 글; mapping a
 * label or an example column makes every row a 단어 of one meaning, with the label's words as its
 * labels and the example's lines as its examples, as direct entry writes them. [idOf] gives a row
 * its card's id.
 */
export function cardsOfRows(
  rows: SheetRow[],
  columns: Columns,
  header: boolean,
  idOf: (row: number) => string,
): SheetCards {
  const result: SheetCards = { cards: [], skipped: [], tooLong: [] };
  const text = (row: SheetRow, column: number | null) =>
    column === null ? "" : (row.cells[column]?.text ?? "");
  for (const row of header ? rows.slice(1) : rows) {
    const front = text(row, columns.front);
    const back = text(row, columns.back);
    const label = text(row, columns.label);
    const example = text(row, columns.example);
    if (front === "" || back === "") result.skipped.push(row.number);
    else if ([front, back, label, example].some((cell) => Array.from(cell).length > cellLimit))
      result.tooLong.push(row.number);
    else
      result.cards.push({
        id: idOf(row.number),
        row: row.number,
        blocks: encodeCells([
          columns.label === null && columns.example === null
            ? textCell(escapeLiteral(front), escapeLiteral(back))
            : word(front, back, label, example),
        ]),
      });
  }
  return result;
}
