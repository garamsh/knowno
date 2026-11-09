/**
 * The 칸 frame as the card tools read it (ADR 0137, ADR 0140): stored blocks parsed by the rules
 * `web/src/features/decks/card-content.ts` and `app/lib/deck/src/card_frame.dart` read by, a card
 * of two sides converted, the rule of a part before the reveal and one added by it, and the card
 * key. `supabase/fixtures/card-frame/` holds the three to one reading.
 */

import { cardKey, isPartOfSpeech, type Label, labelShown } from "./cards.ts";
import {
  clozeNumbers,
  escapeLiteral,
  fillCloze as fillMarkup,
  literalOf,
  parseMarkup,
  plainText as markupPlainText,
} from "./markup.ts";

/** A sense of a 단어 or a v1 `senses` block. */
export type Sense = {
  readonly labels: readonly Label[];
  readonly meaning: string;
  readonly examples: readonly string[];
};
type TableBlank = { readonly row: number; readonly column: number };
type CellSpan = TableBlank & { readonly start: number; readonly end: number };
/** A box over a photo, in fractions of the stored image. */
type ImageBox = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly answer: string | null;
};

/** One stored block, read. */
export type Content =
  | { readonly kind: "text"; readonly text: string }
  | {
    readonly kind: "cloze";
    readonly text: string;
    /** The answers of a version 1 block; null when [text] is Anki's syntax, of version 2. */
    readonly answers: readonly string[] | null;
  }
  | {
    readonly kind: "table";
    readonly columns: readonly string[];
    readonly rows: readonly (readonly string[])[];
    readonly blanks: readonly TableBlank[];
    readonly spans: readonly CellSpan[];
  }
  | { readonly kind: "senses"; readonly senses: readonly Sense[] }
  | {
    readonly kind: "image";
    readonly media: string;
    readonly width: number;
    readonly height: number;
    readonly boxes: readonly ImageBox[];
  }
  | {
    readonly kind: "audio";
    readonly media: string;
    readonly durationMs: number;
  }
  | { readonly kind: "unsupported"; readonly type: string };

/** A side a placed 칸 sits on. */
export type CellSide = "front" | "back";

/** One 칸 of a card, whose type decides whether it has sides (ADR 0137). */
export type Cell =
  | {
    readonly kind: "text";
    readonly front: string;
    readonly back: string;
    /** Whether front and back are markup, a 글 of version 3 (ADR 0208), and not literal. */
    readonly markup: boolean;
  }
  | {
    readonly kind: "word";
    readonly term: string;
    readonly senses: readonly Sense[];
    readonly ask: "term" | "meaning";
  }
  | { readonly kind: "blank"; readonly block: Content }
  | {
    readonly kind: "placed";
    readonly block: Content;
    readonly side: CellSide;
  }
  | { readonly kind: "unknown"; readonly block: Content };

/** The version of each type a 칸 list stores with fields of its own. */
export const FRAME_VERSIONS: ReadonlyMap<string, number> = new Map([
  ["text", 2],
  ["senses", 2],
  ["image", 2],
  ["audio", 2],
]);

/** The version of a 글 whose front and back are markup (ADR 0208); version 2 is literal. */
export const MARKUP_TEXT_VERSION = 3;
/** The version of a cloze whose one text is Anki's syntax (ADR 0202). */
export const MARKUP_CLOZE_VERSION = 2;

/** The version of each type a side reads; a table at v1 holds no spans. */
const SIDE_VERSIONS: ReadonlyMap<string, number> = new Map([
  ["text", 1],
  ["cloze", MARKUP_CLOZE_VERSION],
  ["table", 2],
  ["senses", 1],
  ["image", 1],
  ["audio", 1],
]);

const CLOZE_BLANK = "___";
/** How far past 1 a box's far edge may fall, for a fraction's rounding. */
const BOX_TOLERANCE = 1e-9;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string");
}

function isIndex(value: unknown): value is number {
  return Number.isInteger(value);
}

function parseCloze(payload: Record<string, unknown>): Content | null {
  const { text, answers } = payload;
  if (typeof text !== "string" || !isStrings(answers)) return null;
  if (answers.length === 0 || answers.some((a) => a.trim() === "")) return null;
  if (text.split(CLOZE_BLANK).length - 1 !== answers.length) return null;
  return { kind: "cloze", text, answers };
}

/** A cloze of version 2: a text in Anki's syntax holding at least one cloze; null otherwise. */
function parseClozeMarkup(payload: Record<string, unknown>): Content | null {
  const { text } = payload;
  if (typeof text !== "string") return null;
  return clozeNumbers(parseMarkup(text)).length === 0
    ? null
    : { kind: "cloze", text, answers: null };
}

function isBlank(blanks: readonly TableBlank[], row: number, column: number) {
  return blanks.some((blank) => blank.row === row && blank.column === column);
}

/** A table with a blank or a span, each inside it, as the app's and the web's readers hold it. */
function parseTable(payload: Record<string, unknown>): Content | null {
  const { columns, rows, blanks, spans } = payload;
  if (!isStrings(columns) || columns.length === 0) return null;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (!rows.every((row) => isStrings(row) && row.length === columns.length)) {
    return null;
  }
  const cells = rows as string[][];
  if (!Array.isArray(blanks) || !Array.isArray(spans)) return null;
  if (blanks.length === 0 && spans.length === 0) return null;
  const parsed: TableBlank[] = [];
  for (const blank of blanks as unknown[]) {
    if (!isRecord(blank)) return null;
    const { row, column } = blank;
    if (!isIndex(row) || !isIndex(column)) return null;
    // A cell outside the table reads as "", an empty cell, so this refuses both.
    if ((cells[row]?.[column] ?? "").trim() === "") return null;
    if (isBlank(parsed, row, column)) return null;
    parsed.push({ row, column });
  }
  const runs: CellSpan[] = [];
  for (const span of spans as unknown[]) {
    if (!isRecord(span)) return null;
    const { row, column, start, end } = span;
    if (
      !isIndex(row) || !isIndex(column) || !isIndex(start) || !isIndex(end)
    ) return null;
    const cell = cells[row]?.[column];
    if (cell === undefined || isBlank(parsed, row, column)) return null;
    if (start < 0 || start >= end || end > cell.length) return null;
    if (cell.slice(start, end).trim() === "") return null;
    const overlaps = runs.some((seen) =>
      seen.row === row && seen.column === column && seen.start < end &&
      start < seen.end
    );
    if (overlaps) return null;
    runs.push({ row, column, start, end });
  }
  return { kind: "table", columns, rows: cells, blanks: parsed, spans: runs };
}

function parseLabel(value: unknown): Label | null {
  if (!isRecord(value)) return null;
  const { kind, category, text } = value;
  if (typeof text !== "string" || text.trim() === "") return null;
  if (kind === "part_of_speech" && isPartOfSpeech(category)) {
    return { kind, category, text };
  }
  return kind === "other" && category === null
    ? { kind, category, text }
    : null;
}

function parseSense(value: unknown): Sense | null {
  if (!isRecord(value)) return null;
  const { labels, meaning, examples } = value;
  if (!Array.isArray(labels) || !isStrings(examples)) return null;
  if (typeof meaning !== "string" || meaning.trim() === "") return null;
  const parsed = labels.map(parseLabel);
  return parsed.includes(null)
    ? null
    : { labels: parsed as Label[], meaning, examples };
}

function parseSenses(payload: Record<string, unknown>): Sense[] | null {
  const { senses } = payload;
  if (!Array.isArray(senses) || senses.length === 0) return null;
  const parsed = senses.map(parseSense);
  return parsed.includes(null) ? null : parsed as Sense[];
}

function isFraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseBox(value: unknown): (ImageBox & { id: string }) | null {
  if (!isRecord(value)) return null;
  const { id, x, y, w, h } = value;
  const answer = "answer" in value ? value.answer : null;
  if (typeof id !== "string" || id === "") return null;
  if (!isFraction(x) || !isFraction(y) || !isFraction(w) || !isFraction(h)) {
    return null;
  }
  if (x < 0 || y < 0 || w <= 0 || h <= 0) return null;
  if (x + w > 1 + BOX_TOLERANCE || y + h > 1 + BOX_TOLERANCE) return null;
  if (answer !== null && typeof answer !== "string") return null;
  return { id, x, y, w, h, answer };
}

function parseImage(payload: Record<string, unknown>): Content | null {
  const { media, width, height, boxes } = payload;
  if (typeof media !== "string" || media === "") return null;
  if (!isIndex(width) || !isIndex(height) || width <= 0 || height <= 0) {
    return null;
  }
  if (!Array.isArray(boxes)) return null;
  const parsed = boxes.map(parseBox);
  if (parsed.includes(null)) return null;
  const read = parsed as (ImageBox & { id: string })[];
  if (new Set(read.map(({ id }) => id)).size !== read.length) return null;
  return {
    kind: "image",
    media,
    width,
    height,
    boxes: read.map(({ x, y, w, h, answer }) => ({ x, y, w, h, answer })),
  };
}

function parseAudio(payload: Record<string, unknown>): Content | null {
  const { media, duration_ms: durationMs } = payload;
  if (typeof media !== "string" || media === "") return null;
  if (!isIndex(durationMs) || durationMs <= 0) return null;
  return { kind: "audio", media, durationMs };
}

/** A block of a side at [version], null when it breaks its type's shape. */
function parseBlock(
  type: string,
  version: number,
  payload: unknown,
): Content | null {
  // A v1 table holds whole cells alone.
  const upcast = type === "table" && version === 1 && isRecord(payload)
    ? { ...payload, spans: [] }
    : payload;
  if (!isRecord(upcast)) return null;
  switch (type) {
    case "text":
      return typeof upcast.text === "string"
        ? { kind: "text", text: upcast.text }
        : null;
    case "cloze":
      return version >= MARKUP_CLOZE_VERSION
        ? parseClozeMarkup(upcast)
        : parseCloze(upcast);
    case "table":
      return parseTable(upcast);
    case "senses": {
      const senses = parseSenses(upcast);
      return senses && { kind: "senses", senses };
    }
    case "image":
      return parseImage(upcast);
    default:
      return parseAudio(upcast);
  }
}

/** A stored side, null when it is not a list of blocks each of its type's shape. */
function parseSide(value: unknown): Content[] | null {
  if (!Array.isArray(value)) return null;
  const blocks: Content[] = [];
  for (const block of value as unknown[]) {
    if (!isRecord(block)) return null;
    const { type, v = 1, payload = null } = block;
    if (typeof type !== "string") return null;
    if (!Number.isInteger(v) || (v as number) < 1) return null;
    const known = SIDE_VERSIONS.get(type);
    if (known === undefined || (v as number) > known) {
      blocks.push({ kind: "unsupported", type });
      continue;
    }
    const read = parseBlock(type, v as number, payload);
    // A cloze of version 2 with no cloze in it is kept as read, as a block of a later version is.
    if (read === null && type === "cloze" && (v as number) >= 2) {
      blocks.push({ kind: "unsupported", type });
      continue;
    }
    if (read === null) return null;
    blocks.push(read);
  }
  return blocks;
}

function hasBlank(block: Content): boolean {
  return block.kind === "cloze" || block.kind === "table" ||
    (block.kind === "image" && block.boxes.length > 0);
}

function fillCloze(
  text: string,
  answers: readonly string[] | null,
): string {
  if (answers === null) {
    return markupPlainText(fillMarkup(parseMarkup(text)));
  }
  return text.split(CLOZE_BLANK).map((part, index) =>
    part + (index < answers.length ? answers[index] : "")
  ).join("");
}

function senseLine(sense: Sense): string {
  return [
    ...sense.labels.map((label) => `[${labelShown(label)}]`),
    sense.meaning,
  ].join(" ");
}

function tableText(block: Extract<Content, { kind: "table" }>): string {
  return [block.columns, ...block.rows].map((cells) => cells.join(" | "))
    .join("\n");
}

/** The line a block shows, as the phone's and the web's `describeContent`. */
function describe(block: Content): string {
  switch (block.kind) {
    case "text":
      return block.text;
    case "cloze":
      return fillCloze(block.text, block.answers);
    case "table":
      return tableText(block);
    case "senses":
      return block.senses.map(senseLine).join("\n");
    case "image":
      return "사진";
    case "audio":
      return "소리";
    case "unsupported":
      return `[이 버전에서 표시할 수 없는 내용: ${block.type}]`;
  }
}

/** A side as the phone's `plainText`: a photo's or a sound's media id, and a box's answers. */
function plainText(blocks: readonly Content[]): string {
  return blocks.flatMap((block) => {
    switch (block.kind) {
      case "image":
        return [
          block.media,
          ...block.boxes.flatMap(({ answer }) => answer ?? []),
        ];
      case "audio":
        return [block.media];
      case "unsupported":
        return [];
      default:
        return [describe(block)];
    }
  }).join("\n");
}

function frontCell(block: Content): Cell {
  switch (block.kind) {
    case "text":
      return { kind: "text", front: block.text, back: "", markup: false };
    case "senses":
      return { kind: "word", term: "", senses: block.senses, ask: "meaning" };
    case "cloze":
    case "table":
      return { kind: "blank", block };
    case "image":
      return hasBlank(block)
        ? { kind: "blank", block }
        : { kind: "placed", block, side: "front" };
    case "audio":
      return { kind: "placed", block, side: "front" };
    case "unsupported":
      return { kind: "unknown", block };
  }
}

function parseTextCell(
  payload: Record<string, unknown>,
  markup: boolean,
): Cell | null {
  const { front, back } = payload;
  if (typeof front !== "string" || typeof back !== "string") return null;
  if (front.trim() === "" && back.trim() === "") return null;
  return { kind: "text", front, back, markup };
}

function parseWordCell(payload: Record<string, unknown>): Cell | null {
  const { term, ask } = payload;
  const senses = parseSenses(payload);
  if (typeof term !== "string" || senses === null) return null;
  return ask === "term" || ask === "meaning"
    ? { kind: "word", term, senses, ask }
    : null;
}

/** A 사진 holds `side` exactly while it holds no box, a 소리 always. */
function parsePlacedCell(
  type: string,
  payload: Record<string, unknown>,
): Cell | null {
  const { side, ...rest } = payload;
  const block = parseBlock(type, 1, rest);
  if (block === null) return null;
  if (hasBlank(block)) {
    return side === undefined || side === null
      ? { kind: "blank", block }
      : null;
  }
  return side === "front" || side === "back"
    ? { kind: "placed", block, side }
    : null;
}

function parseCell(block: unknown): Cell | null {
  if (!isRecord(block)) return null;
  const { type, v, id, payload } = block;
  if (
    typeof type === "string" && v !== undefined &&
    (v === FRAME_VERSIONS.get(type) ||
      (type === "text" && v === MARKUP_TEXT_VERSION)) &&
    isRecord(payload)
  ) {
    if (id !== undefined && id !== null && typeof id !== "string") return null;
    if (type === "text") {
      return parseTextCell(payload, v === MARKUP_TEXT_VERSION);
    }
    if (type === "senses") return parseWordCell(payload);
    return parsePlacedCell(type, payload);
  }
  const read = parseSide([block])?.[0];
  return read === undefined ? null : frontCell(read);
}

/** A stored 칸 list, or null when it is no list or a block breaks its shape. */
export function parseCells(value: unknown): Cell[] | null {
  if (!Array.isArray(value)) return null;
  const cells: Cell[] = [];
  for (const block of value as unknown[]) {
    const cell = parseCell(block);
    if (cell === null) return null;
    cells.push(cell);
  }
  return cells;
}

/** Whether [back] is the filled text beside a blanked [front], the one back dropped (ADR 0140). */
function isDerived(front: Content[], back: Content[]): boolean {
  const [only] = back;
  return front.some(hasBlank) &&
    front.every(({ kind }) =>
      kind === "text" || kind === "cloze" || kind === "table"
    ) && back.length === 1 && only.kind === "text" &&
    only.text === front.map(describe).join("\n");
}

function addBackText(cells: Cell[], text: string): void {
  const index = cells.findIndex((cell) =>
    cell.kind === "text" && cell.front !== "" && cell.back === ""
  );
  const cell = cells[index];
  if (cell?.kind === "text") cells[index] = { ...cell, back: text };
  else cells.push({ kind: "text", front: "", back: text, markup: false });
}

function addBackSenses(cells: Cell[], senses: readonly Sense[]): void {
  const [only] = cells;
  if (cells.length === 1 && only.kind === "text" && only.back === "") {
    cells[0] = { kind: "word", term: only.front, senses, ask: "term" };
  } else cells.push({ kind: "word", term: "", senses, ask: "term" });
}

/** A boxed [image] beside a front blank: on the back, its answers a 글 of a back alone. */
function placedOnBack(image: Extract<Content, { kind: "image" }>): Cell[] {
  const answers = image.boxes.flatMap(({ answer }) =>
    answer === null ? [] : [answer]
  );
  const placed: Cell = {
    kind: "placed",
    block: { ...image, boxes: [] },
    side: "back",
  };
  return answers.length > 0
    ? [placed, {
      kind: "text",
      front: "",
      back: answers.join("\n"),
      markup: false,
    }]
    : [placed];
}

function addBack(cells: Cell[], block: Content, frontBlank: boolean): void {
  switch (block.kind) {
    case "text":
      return addBackText(cells, block.text);
    case "senses":
      return addBackSenses(cells, block.senses);
    case "cloze":
    case "table":
      cells.push(
        frontBlank
          ? { kind: "text", front: "", back: describe(block), markup: false }
          : { kind: "blank", block },
      );
      return;
    case "image":
      if (!hasBlank(block)) cells.push({ kind: "placed", block, side: "back" });
      else if (frontBlank) cells.push(...placedOnBack(block));
      else cells.push({ kind: "blank", block });
      return;
    case "audio":
      cells.push({ kind: "placed", block, side: "back" });
      return;
    case "unsupported":
      return;
  }
}

/** Two side lists as a 칸 list, by the rule of ADR 0137 as amended by ADR 0140. */
function cellsFromSides(front: Content[], back: Content[]): Cell[] {
  const cells = front.map(frontCell);
  if (isDerived(front, back)) return cells;
  const [only] = back;
  const words = cells.filter((cell) => cell.kind === "word");
  if (back.length === 1 && only.kind === "text" && words.length === 1) {
    return cells.map((cell) =>
      cell === words[0]
        ? { ...words[0], term: only.text, ask: "meaning" }
        : cell
    );
  }
  const frontBlank = front.some(hasBlank);
  for (const block of back) addBack(cells, block, frontBlank);
  return cells;
}

/** A card's columns as they are stored. */
export type StoredSides = {
  readonly front: unknown;
  readonly back: unknown;
  readonly template: unknown;
  readonly template_version: unknown;
};

/**
 * A stored card as its 칸, as the web's `parseCardContent` draws it: a `free` v2 card's list, any
 * other card's two sides converted, and each block this build does not know kept after them as an
 * unknown 칸. Null when it does not parse.
 */
export function cellsOf(stored: StoredSides): Cell[] | null {
  if (stored.template === "free" && stored.template_version === 2) {
    return parseCells(stored.front);
  }
  const front = parseSide(stored.front);
  const back = parseSide(stored.back);
  if (front === null || back === null) return null;
  const isKnown = (block: Content) => block.kind !== "unsupported";
  return [
    ...cellsFromSides(front.filter(isKnown), back.filter(isKnown)),
    ...[...front, ...back].filter((block) => !isKnown(block)).map(frontCell),
  ];
}

type Part = { readonly block: Content; readonly added: boolean };

function partsOf(cell: Cell): Part[] {
  switch (cell.kind) {
    case "text": {
      const part = (text: string, added: boolean): Part[] =>
        text === "" ? [] : [{
          block: {
            kind: "text",
            text: cell.markup ? markupPlainText(parseMarkup(text)) : text,
          },
          added,
        }];
      return [...part(cell.front, false), ...part(cell.back, true)];
    }
    case "word": {
      const term: Content[] = cell.term === ""
        ? []
        : [{ kind: "text", text: cell.term }];
      const meanings: Content[] = [{ kind: "senses", senses: cell.senses }];
      const [asked, adds] = cell.ask === "term"
        ? [term, meanings]
        : [meanings, term];
      return [
        ...asked.map((block) => ({ block, added: false })),
        ...adds.map((block) => ({ block, added: true })),
      ];
    }
    case "placed":
      return [{ block: cell.block, added: cell.side === "back" }];
    case "blank":
    case "unknown":
      return [{ block: cell.block, added: false }];
  }
}

/** Why a card breaks ADR 0137's rule of a part before the reveal and one added by it. */
export type FrameProblem = "nothing_before" | "nothing_added";

/** The rule [cells] break; a 칸 with blanks or one this build does not know counts for both. */
export function frameProblem(cells: readonly Cell[]): FrameProblem | null {
  const parts = cells.flatMap(partsOf);
  const front = parts.filter(({ added }) => !added).map(({ block }) => block);
  if (front.length === 0) return "nothing_before";
  const question = front.some((block) =>
    hasBlank(block) || block.kind === "unsupported"
  );
  return parts.length === front.length && !question ? "nothing_added" : null;
}

/** What [cells] show before the reveal, every blank filled, in 칸 order. */
export function shownFirst(cells: readonly Cell[]): string {
  return plainText(
    cells.flatMap(partsOf).filter(({ added }) => !added).map(({ block }) =>
      block
    ),
  );
}

/** The card key: the web's `frameKey` and the phone's. */
export function frameKey(cells: readonly Cell[]): string {
  return cardKey(shownFirst(cells));
}

/** Every 칸's text, revealed, as `search_cards` reads a card (ADR 0137). */
export function searchText(cells: readonly Cell[]): string {
  return cells.flatMap(partsOf).flatMap(({ block }) => {
    switch (block.kind) {
      case "image":
        return block.boxes.flatMap(({ answer }) => answer ?? []);
      case "audio":
      case "unsupported":
        return [];
      case "senses":
        return block.senses.flatMap((sense) => [
          senseLine(sense),
          ...sense.examples,
        ]);
      default:
        return [describe(block)];
    }
  }).join("\n");
}

/**
 * A literal text as the markup that reads back as it: itself when the markup reads it unchanged,
 * and otherwise [escapeLiteral]'s, so that a model that sends it back keeps its meaning.
 */
export function markupOfLiteral(text: string): string {
  return literalOf(text) === text ? text : escapeLiteral(text);
}

const senseOut = ({ labels, meaning, examples }: Sense) => ({
  labels: labels.map(labelShown),
  meaning,
  examples,
});

/** A block of a 칸 with blanks, a placed 칸 or an unknown one, in the union. */
function blockOut(block: Content, side?: CellSide): Record<string, unknown> {
  switch (block.kind) {
    case "cloze":
      return block.answers === null
        ? { type: "cloze", text: block.text }
        : { type: "cloze", text: block.text, answers: block.answers };
    case "table":
      return {
        type: "table",
        columns: block.columns,
        rows: block.rows,
        blanks: block.blanks,
        spans: block.spans,
      };
    case "image":
      return {
        type: "image",
        media: block.media,
        width: block.width,
        height: block.height,
        boxes: block.boxes,
        ...(side !== undefined && { side }),
      };
    case "audio":
      return {
        type: "audio",
        media: block.media,
        duration_ms: block.durationMs,
        side,
      };
    case "text":
    case "senses":
    case "unsupported":
      return {
        type: "unknown",
        stored_type: block.kind === "unsupported" ? block.type : block.kind,
      };
  }
}

/** [cells] in the union `add_cards` takes, a literal text escaped while [markup] says text is read as markup; a stored photo names its `media` in place of a url. */
export function blocksOut(
  cells: readonly Cell[],
  markup: boolean,
): Record<string, unknown>[] {
  return cells.map((cell) => {
    switch (cell.kind) {
      case "text":
        return cell.markup || !markup
          ? { type: "text", front: cell.front, back: cell.back }
          : {
            type: "text",
            front: markupOfLiteral(cell.front),
            back: markupOfLiteral(cell.back),
          };
      case "word":
        return {
          type: "senses",
          term: cell.term,
          ask: cell.ask,
          senses: cell.senses.map(senseOut),
        };
      case "placed":
        return blockOut(cell.block, cell.side);
      case "blank":
      case "unknown":
        return blockOut(cell.block);
    }
  });
}
