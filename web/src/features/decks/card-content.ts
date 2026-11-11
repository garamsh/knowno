import {
  clozeNumbers,
  documentText,
  escapeLiteral,
  type Marked,
  markedOf,
} from "@/design/markup-engine";

/**
 * One block of a card side, as the phone stores it: a `{type, v, id, payload}` object in the
 * side's JSON array (`deck.md`), its kind the `type` and its version the `v`, read as 1 when
 * absent (ADR 0106). A text block; a cloze, its text in Anki's syntax; or a table, its column headers, its rows of cells, the cells to recall whole
 * (ADR 0068) and the runs of cells' text to recall (ADR 0110); or a vocabulary entry's senses (ADR 0075); or a photo by its media id, with its
 * intrinsic size and the boxes over it (ADR 0109); or a sound by its media id, with how long it
 * plays in milliseconds (ADR 0112). A block of another type, or of a known
 * type at a version above the one this build reads, is shown as a placeholder naming it, so a
 * card a later version wrote is shown, not lost. A block keeps the id it was stored with, and a
 * photo or a sound the payload fields this build does not know, so a save writes them back. A
 * photo's or a sound's `url` is the signed URL a read drew it from (ADR 0163), never stored.
 *
 * A text that is markup, a 글 of version 3, and a cloze, of version 2, carry what the engine read
 * of their text in `markup`, read once as the block is parsed, so a screen draws it and a card key
 * is made of it without the engine (ADR 0209).
 */
export type Content = (
  | { kind: "text"; text: string; markup: Marked }
  | { kind: "cloze"; text: string; markup: Marked }
  | {
      kind: "table";
      columns: string[];
      rows: string[][];
      blanks: TableBlank[];
      spans: CellSpan[];
    }
  | { kind: "senses"; senses: Sense[] }
  | {
      kind: "image";
      media: string;
      width: number;
      height: number;
      boxes: ImageBox[];
      rest?: Rest;
      url?: string;
    }
  | { kind: "audio"; media: string; durationMs: number; rest?: Rest; url?: string }
  | { kind: "unsupported"; type: string }
) & { id?: string };

/** The fields of a stored photo, box or sound this build does not know. */
export type Rest = Record<string, unknown>;

/**
 * A box over a photo, a blank to recall: its left, top, width and height as fractions, from 0
 * to 1, of the stored image's own width and height, never of a screen, so it covers the same
 * part of the photo at every size it is drawn at, and the answer shown in it once revealed, if
 * any (ADR 0109).
 */
export type ImageBox = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  answer: string | null;
  rest?: Rest;
};

/** Each part of speech a sense's label may name, with the short form every card shows it as. */
export const partsOfSpeech = {
  noun: "명",
  verb: "동",
  adjective: "형",
  adverb: "부",
  pronoun: "대",
  preposition: "전",
  conjunction: "접",
  interjection: "감",
  determiner: "관",
  numeral: "수",
  particle: "조",
  auxiliary: "조동",
  classifier: "양",
  phrase: "구",
} as const;

export type PartOfSpeech = keyof typeof partsOfSpeech;

/**
 * A label the page prints for a sense, without its brackets: a part of speech, or any other
 * label, such as a semantic class, as printed.
 */
export type SenseLabel =
  | { kind: "part_of_speech"; category: PartOfSpeech; text: string }
  | { kind: "other"; category: null; text: string };

/** One meaning of a vocabulary entry, with the labels the page prints for it, and its examples. */
export type Sense = { labels: SenseLabel[]; meaning: string; examples: string[] };

/** What a card shows inside a label's brackets: a part of speech's short form, else the label as printed. */
export function labelShown(label: SenseLabel): string {
  return label.kind === "part_of_speech" ? partsOfSpeech[label.category] : label.text;
}

/** A sense as one line of text, each label in brackets and one space apart: `[명] 사과`. */
export function senseLine(sense: Sense): string {
  return [...sense.labels.map((label) => `[${labelShown(label)}]`), sense.meaning].join(" ");
}

/** A cell of a table block's rows to recall whole: its row and column, each counted from 0. */
export type TableBlank = { row: number; column: number };

/**
 * A run of a table cell's text to recall: the cell's row and column, each counted from 0, and
 * the run's start and end in the cell's UTF-16 code units, as the phone's `CellSpan` (ADR 0110).
 */
export type CellSpan = { row: number; column: number; start: number; end: number };

/** A part of a table cell's text, and whether it is a blank. */
export type CellRun = { text: string; blank: boolean };

type KnownType = "text" | "cloze" | "table" | "senses" | "image" | "audio";

/**
 * The steps that upgrade each known type's payload, one per version: the first turns a v1
 * payload into a v2 one, and so on, as the app's `blockUpcasters` does. The version a type is
 * read at is one more than its steps: a table and a cloze at v2, every other type at v1.
 */
/**
 * A v1 table's payload as v2's: its blanks stay whole cells, and it holds no span (ADR 0110).
 * A payload that is not an object is left to fail parsing.
 */
function tableWithSpans(payload: unknown): unknown {
  return isRecord(payload) ? { ...payload, spans: [] } : payload;
}

/** The step of a version this build does not read: it upgrades nothing, only counts the version. */
const unread = (payload: unknown) => payload;

/** The first version of each type this build reads: older forms are shown as unsupported (ADR 0254). */
const firstRead: Partial<Record<KnownType, number>> = { text: 3, cloze: 2 };

export const blockUpcasters: Record<KnownType, ((payload: unknown) => unknown)[]> = {
  text: [unread, unread],
  cloze: [unread],
  table: [tableWithSpans],
  senses: [],
  image: [],
  audio: [],
};

function isKnownType(type: string): type is KnownType {
  return Object.hasOwn(blockUpcasters, type);
}

/** The version of [type] this build reads, given the [steps] that reach it. */
export function blockVersion(
  type: KnownType,
  steps: Record<KnownType, ((payload: unknown) => unknown)[]> = blockUpcasters,
): number {
  return steps[type].length + 1;
}

/** [payload], stored at [version] of [type], upgraded step by step to the version this build reads. */
export function upcastPayload(
  type: KnownType,
  version: number,
  payload: unknown,
  steps: Record<KnownType, ((payload: unknown) => unknown)[]> = blockUpcasters,
): unknown {
  let upgraded = payload;
  for (const step of steps[type].slice(version - 1)) upgraded = step(upgraded);
  return upgraded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The fields of [payload] but [known], as a property to spread, absent when there are none. */
function restOf(payload: Record<string, unknown>, known: string[]): { rest?: Rest } {
  const rest = Object.entries(payload).filter(([key]) => !known.includes(key));
  return rest.length > 0 ? { rest: Object.fromEntries(rest) } : {};
}

/** [id] as a property to spread, absent when there is none. */
function idOf(id: unknown): { id?: string } {
  return typeof id === "string" ? { id } : {};
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * A cloze: a text in Anki's syntax holding at least one cloze, read by the engine; null otherwise,
 * which the caller keeps as a block this build cannot read (ADR 0209).
 */
function parseClozeMarkup(payload: Record<string, unknown>): Content | null {
  const { text } = payload;
  if (typeof text !== "string" || clozeNumbers(text).length === 0) return null;
  return { kind: "cloze", text, markup: markedOf(text) };
}

/**
 * A table of one or more columns and rows, each row as many cells as there are columns, and one
 * or more blanks inside it, whole cells and spans together: each whole cell distinct and holding
 * text, and each span a run of a cell's text holding more than whitespace, overlapping no other
 * span and in no whole cell (ADR 0110); null otherwise.
 */
function parseTable(payload: Record<string, unknown>): Content | null {
  const { columns, rows, blanks, spans } = payload;
  if (!isStrings(columns) || columns.length === 0) return null;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (!rows.every((row) => isStrings(row) && row.length === columns.length)) return null;
  const cells = rows as string[][];
  if (!Array.isArray(blanks) || !Array.isArray(spans)) return null;
  if (blanks.length === 0 && spans.length === 0) return null;
  const parsed: TableBlank[] = [];
  for (const blank of blanks as unknown[]) {
    if (!isRecord(blank)) return null;
    const { row, column } = blank;
    if (!Number.isInteger(row) || !Number.isInteger(column)) return null;
    const at = { row: row as number, column: column as number };
    // A cell outside the table reads as "", an empty cell, so this refuses both.
    if ((cells[at.row]?.[at.column] ?? "").trim() === "") return null;
    if (isBlank(parsed, at.row, at.column)) return null;
    parsed.push(at);
  }
  const runs: CellSpan[] = [];
  for (const span of spans as unknown[]) {
    if (!isRecord(span)) return null;
    const { row, column, start, end } = span;
    if (![row, column, start, end].every(Number.isInteger)) return null;
    const at = {
      row: row as number,
      column: column as number,
      start: start as number,
      end: end as number,
    };
    // A row or column outside the table, negative ones included, reads as undefined.
    const cell = cells[at.row]?.[at.column];
    if (cell === undefined || isBlank(parsed, at.row, at.column)) return null;
    if (at.start < 0 || at.start >= at.end || at.end > cell.length) return null;
    if (cell.slice(at.start, at.end).trim() === "") return null;
    const overlaps = runs.some(
      (seen) =>
        seen.row === at.row &&
        seen.column === at.column &&
        seen.start < at.end &&
        at.start < seen.end,
    );
    if (overlaps) return null;
    runs.push(at);
  }
  return { kind: "table", columns, rows: cells, blanks: parsed, spans: runs };
}

function isPartOfSpeech(value: unknown): value is PartOfSpeech {
  return typeof value === "string" && Object.hasOwn(partsOfSpeech, value);
}

function parseLabel(value: unknown): SenseLabel | null {
  if (!isRecord(value)) return null;
  const { kind, category, text } = value;
  if (typeof text !== "string" || text.trim() === "") return null;
  if (kind === "part_of_speech" && isPartOfSpeech(category)) {
    return { kind, category, text };
  }
  if (kind === "other" && category === null) return { kind, category, text };
  return null;
}

function parseSense(value: unknown): Sense | null {
  if (!isRecord(value)) return null;
  const { labels, meaning, examples } = value;
  if (!Array.isArray(labels) || typeof meaning !== "string" || meaning.trim() === "") return null;
  if (!isStrings(examples)) return null;
  const parsed = labels.map(parseLabel);
  if (parsed.some((label) => label === null)) return null;
  return { labels: parsed as SenseLabel[], meaning, examples };
}

/** One or more senses, each `{labels, meaning, examples}` as the phone writes it; null otherwise. */
function parseSenses(
  payload: Record<string, unknown>,
): Extract<Content, { kind: "senses" }> | null {
  const { senses } = payload;
  if (!Array.isArray(senses) || senses.length === 0) return null;
  const parsed = senses.map(parseSense);
  if (parsed.some((sense) => sense === null)) return null;
  return { kind: "senses", senses: parsed as Sense[] };
}

/** How far past 1 a box's far edge may fall, for a fraction's rounding, as on the phone. */
const boxTolerance = 1e-9;

function isFraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A box of a non-empty id, an optional text answer, and a left and top at or above 0 and a
 * width and height above 0 whose far edges fall inside the image; null otherwise.
 */
function parseBox(value: unknown): ImageBox | null {
  if (!isRecord(value)) return null;
  const { id, x, y, w, h } = value;
  const answer = "answer" in value ? value.answer : null;
  if (typeof id !== "string" || id === "") return null;
  if (!isFraction(x) || !isFraction(y) || !isFraction(w) || !isFraction(h)) return null;
  if (x < 0 || y < 0 || w <= 0 || h <= 0) return null;
  if (x + w > 1 + boxTolerance || y + h > 1 + boxTolerance) return null;
  if (answer !== null && typeof answer !== "string") return null;
  return { id, x, y, w, h, answer, ...restOf(value, ["id", "x", "y", "w", "h", "answer"]) };
}

/**
 * A photo of a non-empty media id, a positive whole width and height, and boxes, their ids
 * distinct; null otherwise (ADR 0109).
 */
function parseImage(payload: Record<string, unknown>): Content | null {
  const { media, width, height, boxes } = payload;
  if (typeof media !== "string" || media === "") return null;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if ((width as number) <= 0 || (height as number) <= 0) return null;
  if (!Array.isArray(boxes)) return null;
  const parsed = (boxes as unknown[]).map(parseBox);
  if (parsed.some((box) => box === null)) return null;
  const ids = new Set(parsed.map((box) => box?.id));
  if (ids.size !== parsed.length) return null;
  return {
    kind: "image",
    media,
    width: width as number,
    height: height as number,
    boxes: parsed as ImageBox[],
    ...restOf(payload, ["media", "width", "height", "boxes"]),
  };
}

/** A sound of a non-empty media id and a positive whole `duration_ms`; null otherwise (ADR 0112). */
function parseAudio(payload: Record<string, unknown>): Content | null {
  const { media, duration_ms: durationMs } = payload;
  if (typeof media !== "string" || media === "") return null;
  if (!Number.isInteger(durationMs) || (durationMs as number) <= 0) return null;
  return {
    kind: "audio",
    media,
    durationMs: durationMs as number,
    ...restOf(payload, ["media", "duration_ms"]),
  };
}

/**
 * The blocks of a stored card side without their ids, or null as [parseStoredBlocks] says.
 */
export function parseContent(value: unknown): Content[] | null {
  const blocks = parseStoredBlocks(value);
  return (
    blocks &&
    blocks.map((block) => {
      const read = { ...block };
      delete read.id;
      return read;
    })
  );
}

/**
 * The blocks of a stored card side, each with the id it was stored with, or null when [value] is
 * not an array of blocks each with a string `type`, a `v` that is a positive integer when present,
 * an `id` that is text when present, and a payload of its type's shape for a text, cloze, table or
 * senses block at the version this build reads, an older one upgraded first.
 */
function parseStoredBlocks(value: unknown): Content[] | null {
  if (!Array.isArray(value)) return null;
  const blocks: Content[] = [];
  for (const block of value as unknown[]) {
    if (!isRecord(block)) return null;
    const type = "type" in block ? block.type : null;
    const version = "v" in block ? block.v : 1;
    const id = "id" in block ? block.id : undefined;
    if (typeof type !== "string") return null;
    if (!Number.isInteger(version) || (version as number) < 1) return null;
    if (id !== undefined && typeof id !== "string") return null;
    if (
      !isKnownType(type) ||
      (version as number) > blockVersion(type) ||
      (version as number) < (firstRead[type] ?? 1)
    ) {
      blocks.push({ kind: "unsupported", type, ...idOf(id) });
      continue;
    }
    const payload = upcastPayload(
      type,
      version as number,
      "payload" in block ? block.payload : null,
    );
    if (!isRecord(payload)) return null;
    const parsed =
      type === "text"
        ? typeof payload.text === "string"
          ? ({ kind: "text", text: payload.text, markup: markedOf(payload.text) } as const)
          : null
        : type === "cloze"
          ? parseClozeMarkup(payload)
          : type === "table"
            ? parseTable(payload)
            : type === "senses"
              ? parseSenses(payload)
              : type === "image"
                ? parseImage(payload)
                : parseAudio(payload);
    // A cloze with no cloze in it is kept as read, as a block of a later version is.
    if (!parsed && type === "cloze") {
      blocks.push({ kind: "unsupported", type, ...idOf(id) });
      continue;
    }
    if (!parsed) return null;
    blocks.push({ ...parsed, ...idOf(id) });
  }
  return blocks;
}

/**
 * Whether [block] holds blanks to recall: a cloze or a table, or a photo with a box over it
 * (ADR 0109).
 */
function hasBlank(block: Content): boolean {
  return (
    block.kind === "cloze" ||
    block.kind === "table" ||
    (block.kind === "image" && block.boxes.length > 0)
  );
}

/** Whether a table block's cell at [row] and [column] is one to recall whole. */
function isBlank(blanks: TableBlank[], row: number, column: number): boolean {
  return blanks.some((blank) => blank.row === row && blank.column === column);
}

/**
 * A table block's cell at [row] and [column] as runs of its text, in order, as the phone's
 * `cellRuns`: one blank run when it is a whole blank, its text split around its spans when it
 * holds any, and otherwise one plain run.
 */
export function cellRuns(
  table: Extract<Content, { kind: "table" }>,
  row: number,
  column: number,
): CellRun[] {
  const text = table.rows[row]?.[column] ?? "";
  if (isBlank(table.blanks, row, column)) return [{ text, blank: true }];
  const inCell = table.spans
    .filter((span) => span.row === row && span.column === column)
    .sort((a, b) => a.start - b.start);
  const runs: CellRun[] = [];
  let at = 0;
  for (const span of inCell) {
    if (at < span.start) runs.push({ text: text.slice(at, span.start), blank: false });
    runs.push({ text: text.slice(span.start, span.end), blank: true });
    at = span.end;
  }
  if (at < text.length || runs.length === 0) runs.push({ text: text.slice(at), blank: false });
  return runs;
}

/** A cloze block's text with each blank as [fill] gives it, in order. */
function filledCloze(
  block: Extract<Content, { kind: "cloze" }>,
  fill: (answer: string) => string,
): string {
  return documentText(block.markup.document, fill);
}

/**
 * The one line of text a card side shows, its blocks joined by spaces, as on the phone: a cloze
 * or a table with its blanks filled.
 */
export function describeContent(blocks: Content[]): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case "text":
          return block.markup.plain;
        case "cloze":
          return block.markup.plain;
        case "table":
          return [block.columns, ...block.rows].map((cells) => cells.join(" | ")).join("\n");
        case "senses":
          return block.senses.map(senseLine).join("\n");
        case "image":
          return "사진";
        case "audio":
          return "소리";
        case "unsupported":
          return `[이 버전에서 표시할 수 없는 내용: ${block.type}]`;
      }
    })
    .join(" ");
}

/**
 * A card side as the phone's `plainText` gives it, one block's text after another on lines of
 * their own: a filled cloze or table, a photo's or a sound's media id, and no line for a block
 * this build does not know.
 */
export function plainText(blocks: Content[]): string {
  return blocks
    .flatMap((block) => {
      switch (block.kind) {
        case "image":
          return [block.media, ...block.boxes.flatMap(({ answer }) => answer ?? [])];
        case "audio":
          return [block.media];
        case "unsupported":
          return [];
        default:
          return [describeContent([block])];
      }
    })
    .join("\n");
}

/**
 * A card side as a screen reader reads it, as on the phone: each blank as its answer only when
 * [revealed], else as "빈칸", a table row by row, its cells joined by commas, a span in its
 * cell's text, and the blocks as sentences.
 */
export function spokenContent(blocks: Content[], revealed: boolean): string {
  const blank = (answer: string) => (revealed ? answer : "빈칸");
  return blocks
    .map((block) => {
      switch (block.kind) {
        case "cloze":
          return filledCloze(block, blank);
        case "table":
          return [
            block.columns.join(", "),
            ...block.rows.map((cells, row) =>
              cells
                .map((_, column) =>
                  cellRuns(block, row, column)
                    .map((run) => (run.blank ? blank(run.text) : run.text))
                    .join(""),
                )
                .join(", "),
            ),
          ].join(". ");
        case "image":
          // The photo, then each box as a blank, or its answer once revealed.
          return [
            "사진",
            ...block.boxes.map((box) =>
              box.answer !== null && box.answer.trim() !== "" ? blank(box.answer) : "빈칸",
            ),
          ].join(", ");
        default:
          return describeContent([block]);
      }
    })
    .join(". ");
}

/** A sound block, as [Content] holds one. */
export type AudioBlock = Extract<Content, { kind: "audio" }>;

/** The sounds among [blocks], in order (ADR 0112). */
export function audioOf(blocks: Content[]): AudioBlock[] {
  return blocks.filter((block): block is AudioBlock => block.kind === "audio");
}

/** How long a sound plays, as minutes and seconds rounded up to the second, `0:07`, as on the phone. */
export function audioLength(durationMs: number): string {
  const seconds = Math.ceil(durationMs / 1000);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A side a placed 칸 sits on. */
export type CellSide = "front" | "back";

/** Which of a 단어's parts shows before the reveal. */
export type WordAsk = "term" | "meaning";

/**
 * One 칸 of a card, whose type decides whether it has sides (ADR 0137): a 글, its front shown
 * before the reveal and its back added by it, either empty; a 단어, its word and meanings, [ask]
 * naming the one shown first; a 칸 whose blanks are the question and whose filling is the answer;
 * a 사진 without a box or a 소리 on one side; or a 칸 this build does not know, kept as read. A 글
 * or a 단어 keeps its stored block's [id], as every other 칸's block does. A 글 whose parts are
 * markup, stored as version 3, holds what the engine read of each in [marks] (ADR 0209).
 */
export type Cell =
  | { kind: "text"; front: string; back: string; marks: TextMarks; id?: string }
  | { kind: "word"; term: string; senses: Sense[]; ask: WordAsk; id?: string }
  | { kind: "blank"; block: Content }
  | { kind: "placed"; block: Content; side: CellSide }
  | { kind: "unknown"; block: Content };

/** What the engine read of a markup 글's two parts. */
export type TextMarks = { front: Marked; back: Marked };

/** [front] and [back] read by the engine, as a 글 of version 3 holds them. */
export function marksOf(front: string, back: string): TextMarks {
  return { front: markedOf(front), back: markedOf(back) };
}

/** A 글 of [front] and [back], markup, read by the engine; it keeps [id] when given. */
export function textCell(
  front: string,
  back: string,
  id?: string,
): Extract<Cell, { kind: "text" }> {
  return { kind: "text", front, back, marks: marksOf(front, back), ...idOf(id) };
}

function isUnknown(block: Content): boolean {
  return block.kind === "unsupported";
}

/** The version of each type a 칸 list stores with fields of its own, as the phone's `_frameVersions`. */
export const frameVersions = new Map([
  ["text", 3],
  ["senses", 2],
  ["image", 2],
  ["audio", 2],
]);

/** [block] as a 칸 drawn where it was on a front. */
function frontCell(block: Content): Cell {
  switch (block.kind) {
    case "text":
      return textCell(block.text, "", block.id);
    case "senses":
      return { kind: "word", term: "", senses: block.senses, ask: "meaning", ...idOf(block.id) };
    case "cloze":
    case "table":
      return { kind: "blank", block };
    case "image":
      return hasBlank(block) ? { kind: "blank", block } : { kind: "placed", block, side: "front" };
    case "audio":
      return { kind: "placed", block, side: "front" };
    case "unsupported":
      return { kind: "unknown", block };
  }
}

function parseTextCell(payload: Record<string, unknown>, id: unknown): Cell | null {
  const { front, back } = payload;
  if (typeof front !== "string" || typeof back !== "string") return null;
  if (front.trim() === "" && back.trim() === "") return null;
  return textCell(front, back, typeof id === "string" ? id : undefined);
}

function parseWordCell(payload: Record<string, unknown>, id: unknown): Cell | null {
  const { term, ask } = payload;
  const read = parseSenses(payload);
  if (typeof term !== "string" || !read || (ask !== "term" && ask !== "meaning")) return null;
  return { kind: "word", term, senses: read.senses, ask, ...idOf(id) };
}

/** A v2 image or audio block: a 사진 holds `side` exactly while it holds no box, a 소리 always. */
function parsePlacedCell(type: string, payload: Record<string, unknown>, id: unknown): Cell | null {
  const { side, ...rest } = payload;
  const block = parseStoredBlocks([{ type, ...idOf(id), payload: rest }])?.[0];
  if (!block) return null;
  if (hasBlank(block)) return side === undefined || side === null ? { kind: "blank", block } : null;
  return side === "front" || side === "back" ? { kind: "placed", block, side } : null;
}

function parseCell(block: unknown): Cell | null {
  if (!isRecord(block)) return null;
  const { type, v, id, payload } = block;
  if (
    typeof type === "string" &&
    v !== undefined &&
    v === frameVersions.get(type) &&
    isRecord(payload)
  ) {
    if (id !== undefined && id !== null && typeof id !== "string") return null;
    if (type === "text") return parseTextCell(payload, id);
    if (type === "senses") return parseWordCell(payload, id);
    return parsePlacedCell(type, payload, id);
  }
  const read = parseStoredBlocks([block])?.[0];
  return read ? frontCell(read) : null;
}

/**
 * A stored 칸 list, or null when [value] is not a list or a block breaks its shape: a block of
 * the frame's versions reads its own fields, one of an earlier version reads as it was drawn on a
 * front, and an unknown type or version is kept.
 */
export function parseCells(value: unknown): Cell[] | null {
  if (!Array.isArray(value)) return null;
  const cells: Cell[] = [];
  for (const block of value as unknown[]) {
    const cell = parseCell(block);
    if (!cell) return null;
    cells.push(cell);
  }
  return cells;
}

/**
 * Whether [back] is the filled text photo import and a copy wrote beside a blanked [front], the
 * one back the frame drops (ADR 0140).
 */
function isDerived(front: Content[], back: Content[]): boolean {
  const [only] = back;
  return (
    front.some(hasBlank) &&
    front.every(({ kind }) => kind === "text" || kind === "cloze" || kind === "table") &&
    back.length === 1 &&
    only?.kind === "text" &&
    only.markup.plain === front.map((block) => describeContent([block])).join("\n")
  );
}

function addBackText(cells: Cell[], text: string, id: string | undefined): void {
  const index = cells.findIndex(
    (cell) => cell.kind === "text" && cell.front !== "" && cell.back === "",
  );
  const cell = cells[index];
  if (cell?.kind === "text") cells[index] = textCell(cell.front, text, cell.id);
  else cells.push(textCell("", text, id));
}

function addBackSenses(cells: Cell[], senses: Sense[], id: string | undefined): void {
  const [only] = cells;
  if (cells.length === 1 && only?.kind === "text" && only.back === "") {
    cells[0] = {
      kind: "word",
      term: only.marks.front.plain,
      senses,
      ask: "term",
      ...idOf(only.id),
    };
  } else {
    cells.push({ kind: "word", term: "", senses, ask: "term", ...idOf(id) });
  }
}

/**
 * A boxed [image] beside a front blank: placed on the back without its boxes, with their answers
 * in a 글 of a back alone when it has any (ADR 0140).
 */
function placedOnBack(image: Extract<Content, { kind: "image" }>): Cell[] {
  const answers = image.boxes.flatMap(({ answer }) => (answer === null ? [] : [answer]));
  const placed: Cell = { kind: "placed", block: { ...image, boxes: [] }, side: "back" };
  return answers.length > 0 ? [placed, textCell("", escapeLiteral(answers.join("\n")))] : [placed];
}

/** [block] of a back added to [cells], beside a front holding a blank when [frontBlank]. */
function addBack(cells: Cell[], block: Content, frontBlank: boolean): void {
  switch (block.kind) {
    case "text":
      addBackText(cells, block.text, block.id);
      break;
    case "senses":
      addBackSenses(cells, block.senses, block.id);
      break;
    case "cloze":
    case "table":
      cells.push(
        frontBlank
          ? textCell("", escapeLiteral(describeContent([block])), block.id)
          : { kind: "blank", block },
      );
      break;
    case "image":
      if (!hasBlank(block)) cells.push({ kind: "placed", block, side: "back" });
      else if (frontBlank) cells.push(...placedOnBack(block));
      else cells.push({ kind: "blank", block });
      break;
    case "audio":
      cells.push({ kind: "placed", block, side: "back" });
      break;
    case "unsupported":
      // `cellsFromSides` leaves a card holding one as it is.
      break;
  }
}

/**
 * A card's two side lists as its 칸 list, by the rule of ADR 0137 as amended by ADR 0140, on the
 * fixtures the phone's `cellsFromSides` reads; null when either holds a block this build does not
 * know, which stays as it is.
 */
export function cellsFromSides(front: Content[], back: Content[]): Cell[] | null {
  if ([...front, ...back].some(isUnknown)) return null;
  const cells = front.map(frontCell);
  if (isDerived(front, back)) return cells;
  const [only] = back;
  const words = cells.filter((cell) => cell.kind === "word");
  const [word] = words;
  if (back.length === 1 && only?.kind === "text" && word && words.length === 1) {
    return cells.map((cell) =>
      cell === word ? { ...word, term: only.markup.plain, ask: "meaning" } : cell,
    );
  }
  const frontBlank = front.some(hasBlank);
  for (const block of back) addBack(cells, block, frontBlank);
  return cells;
}

/**
 * The 칸 a card of [front] and [back] is drawn from, as the phone's `cellsToDraw`: what this build
 * knows converted, and each block it cannot show kept after them.
 */
function cellsToDraw(front: Content[], back: Content[]): Cell[] {
  const known = (side: Content[]) => side.filter((block) => !isUnknown(block));
  return [
    ...(cellsFromSides(known(front), known(back)) ?? []),
    ...[...front, ...back].filter(isUnknown).map(frontCell),
  ];
}

/** A part of a 칸: a block, and whether the reveal adds it. */
export type CellPart = { block: Content; added: boolean };

function partsOf(cell: Cell): CellPart[] {
  switch (cell.kind) {
    case "text": {
      const part = (text: string, added: boolean, markup: Marked): CellPart[] =>
        text === "" ? [] : [{ block: { kind: "text", text, markup }, added }];
      return [
        ...part(cell.front, false, cell.marks.front),
        ...part(cell.back, true, cell.marks.back),
      ];
    }
    case "word": {
      const literal = escapeLiteral(cell.term);
      const term: Content[] =
        cell.term === "" ? [] : [{ kind: "text", text: literal, markup: markedOf(literal) }];
      const meanings: Content[] = [{ kind: "senses", senses: cell.senses }];
      const [asked, adds] = cell.ask === "term" ? [term, meanings] : [meanings, term];
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

/** What [cells] show in order, every 칸 in place: before the reveal, or all of it once [revealed]. */
export function shownParts(cells: Cell[], revealed: boolean): CellPart[] {
  return cells.flatMap(partsOf).filter(({ added }) => revealed || !added);
}

/**
 * The two sides [cells] read as (ADR 0137): every part shown before the reveal as the front,
 * every part added by it as the back, and a 칸 with blanks on the front.
 */
export function sidesOf(cells: Cell[]): { front: Content[]; back: Content[] } {
  const parts = cells.flatMap(partsOf);
  const side = (added: boolean) =>
    parts.filter((part) => part.added === added).map(({ block }) => block);
  return { front: side(false), back: side(true) };
}

/** Whether a card of [cells] is drawn whole, each 칸 in place, rather than split (ADR 0137). */
export function holdsBlank(cells: Cell[]): boolean {
  return cells.some((cell) => cell.kind === "blank");
}

/** [cells] as a screen reader reads them: in order, each blank as `spokenContent` says. */
export function spokenCells(cells: Cell[], revealed: boolean): string {
  return spokenContent(
    shownParts(cells, revealed).map(({ block }) => block),
    revealed,
  );
}

/** Why a card of [cells] breaks ADR 0137's rule of a part before the reveal and one added by it. */
export type FrameProblem = "nothing_before" | "nothing_added";

/** The rule [cells] break, a 칸 with blanks or one this build does not know counting for both. */
export function frameProblem(cells: Cell[]): FrameProblem | null {
  const { front, back } = sidesOf(cells);
  if (front.length === 0) return "nothing_before";
  const question = front.some((block) => hasBlank(block) || block.kind === "unsupported");
  return back.length === 0 && !question ? "nothing_added" : null;
}

/** The template a card in the 칸 frame records, at [cardFrameVersion]. */
const freeTemplate = "free";

/** The version of [freeTemplate] that stores a card as one list of 칸 (ADR 0137). */
const cardFrameVersion = 2;

/** The templates earlier builds wrote, at version 1 or none (ADR 0114). */
const earlierTemplates: ReadonlySet<unknown> = new Set([freeTemplate, "flip", "cloze", "table"]);

/** Whether a card of [template] at [version] stores a list of 칸. */
export function isFramed(template: unknown, version: unknown): boolean {
  return template === freeTemplate && version === cardFrameVersion;
}

/** Whether a card of [template] at [version] is one a build wrote as two side lists. */
export function isEarlier(template: unknown, version: unknown): boolean {
  if (template === undefined || template === null) return true;
  return earlierTemplates.has(template) && (typeof version !== "number" || version <= 1);
}

/**
 * A stored card's content: its 칸 and the two sides they read as; [readOnly] when this build cannot
 * edit it, a card of a later template or holding a block this build does not know (ADR 0106).
 */
export type CardContent = { cells: Cell[]; front: Content[]; back: Content[]; readOnly?: true };

/**
 * A stored card as its 칸, or null when it does not parse: a `free` v2 card's list; an earlier
 * card's two sides converted; and a card of a later template, or holding a block this build does
 * not know, its sides as stored and its 칸 only to place what it holds.
 */
export function parseCardContent(stored: {
  front: unknown;
  back: unknown;
  template: unknown;
  templateVersion: unknown;
}): CardContent | null {
  if (isFramed(stored.template, stored.templateVersion)) {
    const cells = parseCells(stored.front);
    if (!cells) return null;
    const read = { cells, ...sidesOf(cells) };
    return cells.some(({ kind }) => kind === "unknown") ? { ...read, readOnly: true } : read;
  }
  const front = parseStoredBlocks(stored.front);
  const back = parseStoredBlocks(stored.back);
  if (!front || !back) return null;
  const cells = isEarlier(stored.template, stored.templateVersion)
    ? cellsFromSides(front, back)
    : null;
  return cells
    ? { cells, ...sidesOf(cells) }
    : { cells: cellsToDraw(front, back), front, back, readOnly: true };
}
