/**
 * A card of an `add_cards` or `update_cards` call read into the stored `free` v2 form (ADR 0137
 * §One input format): `{"blocks": [칸, …]}` in the union on `type`, or the plain front and back.
 * Each 칸 is built as the block the web's `encodeCells` writes, then held to the frame's own reader.
 */

import { type IdSource, labelsOf, uuidV7 } from "./cards.ts";
import {
  type Cell,
  FRAME_VERSIONS,
  frameKey,
  frameProblem,
  MARKUP_CLOZE_VERSION,
  MARKUP_TEXT_VERSION,
  parseCells,
  shownFirst,
  type StoredSides,
} from "./frame.ts";
import {
  clozeFromV1,
  clozeNumbers,
  clozeToV1,
  parseMarkup,
  unfinishedClozes,
} from "./markup.ts";

/** The longest a card's text may be. */
export const MAX_TEXT = 2000;
export const MAX_EXAMPLES = 10;
export const MAX_LABELS = 10;
/** The most senses a 단어 holds. */
export const MAX_SENSES = 20;
/** The most 칸 a card holds, as the web's save takes. */
export const MAX_BLOCKS = 100;

/** The 칸 types a card of a call may hold; a sound is only kept, by its media, on update. */
export const BLOCK_TYPES = [
  "text",
  "senses",
  "cloze",
  "table",
  "image",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** A block as stored in `cards.front`. */
export type StoredBlock = {
  readonly type: string;
  readonly v: number;
  readonly id: string;
  readonly payload: Record<string, unknown>;
};

/** A 사진 still to fetch: the id it will be stored under, and the address. */
export type PendingPhoto = { readonly media: string; readonly url: string };

/** A card read: its blocks, a pending photo at a placeholder size, and what it shows first. */
export type ReadCard = {
  readonly blocks: readonly StoredBlock[];
  readonly photos: readonly PendingPhoto[];
  readonly key: string;
  readonly front: string;
};

type Args = Record<string, unknown>;

/**
 * How a call reads and writes text (ADR 0216). With `markup` off, a text is literal and written at
 * version 2 as given, and a cloze is written at version 1. With it on, a text is markup written at
 * version 3 and a cloze at version 2. A cloze is accepted in either form whichever it says.
 */
export type Writes = { readonly markup: boolean };

function isRecord(value: unknown): value is Args {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Text trimmed, or null when it is not text or is longer than [MAX_TEXT]. */
function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > MAX_TEXT ? null : text;
}

/** Text trimmed, or null when it is also empty. */
function requiredText(value: unknown): string | null {
  const text = optionalText(value);
  return text === "" ? null : text;
}

/** [value] as a list of at most [max] texts, or a refusal naming [field]. */
function texts(
  value: unknown,
  field: string,
  max: number,
): string[] | string {
  const items = value ?? [];
  if (!Array.isArray(items) || items.length > max) {
    return `${field} must be a list of at most ${max} texts.`;
  }
  const read = items.map(requiredText);
  return read.includes(null)
    ? `each of ${field} must be text of 1 to ${MAX_TEXT} characters.`
    : read as string[];
}

function sense(value: unknown) {
  if (!isRecord(value)) return "each sense must be an object with a meaning.";
  const meaning = requiredText(value.meaning);
  if (meaning === null) {
    return `each meaning must be text of 1 to ${MAX_TEXT} characters.`;
  }
  const labels = texts(value.labels, "labels", MAX_LABELS);
  if (typeof labels === "string") return labels;
  const examples = texts(value.examples, "examples", MAX_EXAMPLES);
  if (typeof examples === "string") return examples;
  return { labels: labelsOf(labels), meaning, examples };
}

/** A 칸's payload, or a sentence saying what is wrong with it. */
type Built =
  | {
    readonly payload: Args;
    readonly url?: string;
    /** The version it is written at, when it is not its type's usual. */
    readonly v?: number;
  }
  | string;

/** A text block: its front and back are markup while [writes] says so, and literal otherwise. */
function textBlock(value: Args, writes: Writes): Built {
  const front = optionalText(value.front ?? "");
  const back = optionalText(value.back ?? "");
  if (front === null || back === null) {
    return `a text block's front and back must be text of at most ${MAX_TEXT} characters.`;
  }
  return writes.markup
    ? { payload: { front, back }, v: MARKUP_TEXT_VERSION }
    : { payload: { front, back } };
}

function sensesBlock(value: Args): Built {
  const term = optionalText(value.term ?? "");
  if (term === null) {
    return `term must be text of at most ${MAX_TEXT} characters.`;
  }
  const list = value.senses;
  if (!Array.isArray(list) || list.length > MAX_SENSES) {
    return `senses must be a list of 1 to ${MAX_SENSES} senses.`;
  }
  const senses = list.map(sense);
  const refused = senses.find((item) => typeof item === "string");
  if (typeof refused === "string") return refused;
  return { payload: { term, senses, ask: value.ask ?? "term" } };
}

/** Whether every text of a list of [value] stays within the limit. */
function withinLimit(value: unknown): boolean {
  return !Array.isArray(value) ||
    value.flat().every((item) =>
      typeof item !== "string" || item.length <= MAX_TEXT
    );
}

const NO_CLOZE =
  "a cloze's text needs at least one {{c1::answer}} or {{c1::answer::hint}}, each with an answer that is not blank.";
const NO_V1 =
  "a cloze in {{c1::answer}} form cannot be written yet when it has a hint, a number used twice or out of order from 1, a mark or a list: give each blank its own number from 1 in order, with plain text, or the form with ___ and answers.";
const UNFINISHED =
  "a cloze's text has a {{cN:: that is no cloze: give it an answer that is not blank and a closing }}, and no cloze inside another; write a literal { or : after a backslash.";

/**
 * A cloze: `text` with `answers`, one `___` for each, or `text` alone in Anki's syntax. Written at
 * version 2 while [writes] says so, and otherwise at version 1; an Anki cloze with no version 1 form
 * is refused.
 */
function clozeBlock(value: Args, writes: Writes): Built {
  const { text, answers } = value;
  if (!withinLimit([text]) || !withinLimit(answers)) {
    return `a cloze's text and answers must be at most ${MAX_TEXT} characters each.`;
  }
  if (answers === undefined) {
    if (typeof text !== "string") return NO_CLOZE;
    if (clozeNumbers(parseMarkup(text)).length === 0) {
      return unfinishedClozes(text) > 0 ? UNFINISHED : NO_CLOZE;
    }
    if (unfinishedClozes(text) > 0) return UNFINISHED;
    if (writes.markup) {
      return { payload: { text }, v: MARKUP_CLOZE_VERSION };
    }
    const v1 = clozeToV1(text);
    return v1 === null ? NO_V1 : { payload: v1 };
  }
  if (!writes.markup || typeof text !== "string" || !isStrings(answers)) {
    return { payload: { text, answers } };
  }
  const source = clozeFromV1(text, answers);
  return source === null
    ? { payload: { text, answers } }
    : { payload: { text: source }, v: MARKUP_CLOZE_VERSION };
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string");
}

const TABLE_FORM =
  '{"type":"table","columns":["구분","A"],"rows":[["수도","평양"]],"blanks":[{"row":0,"column":1}]}';

/**
 * Why a table's columns, rows or blanks are refused, naming the field and the cell, or null when
 * they hold: the frame's reader says only that a table is wrong, and a photo's table has many cells.
 */
function tableProblem(
  { columns, rows, blanks = [], spans = [] }: Args,
): string | null {
  if (!isStrings(columns) || columns.length === 0) {
    return `a table needs columns: a list of the column headings as text, such as ["구분","A"]. The form is ${TABLE_FORM}.`;
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return `a table needs rows: a list of rows, each a list of text with one cell per column. The form is ${TABLE_FORM}.`;
  }
  for (const [index, row] of rows.entries()) {
    if (!isStrings(row) || row.length !== columns.length) {
      return `a table needs every row to be a list of ${columns.length} texts, one per column, and rows[${index}] is ${
        isStrings(row) ? `${row.length} texts` : "not a list of texts"
      }; write a cell with nothing as "-".`;
    }
  }
  if (!Array.isArray(blanks) || !Array.isArray(spans)) {
    return `a table needs blanks and spans to be lists. The form is ${TABLE_FORM}.`;
  }
  if (blanks.length === 0 && spans.length === 0) {
    return `a table needs blanks, the cells to recall, or spans: none was given. Add blanks, counting row and column from 0, such as ${TABLE_FORM}.`;
  }
  for (const [index, blank] of blanks.entries()) {
    const { row, column } = isRecord(blank) ? blank : ({} as Args);
    const cell = Number.isInteger(row) && Number.isInteger(column)
      ? (rows as string[][])[row as number]?.[column as number]
      : undefined;
    if (cell === undefined || cell.trim() === "") {
      return `a table needs each blank to be the row and column of a cell holding text, counted from 0, and blanks[${index}] is ${
        cell === undefined
          ? "outside the table's " + rows.length + " rows and " +
            columns.length + " columns"
          : "an empty cell"
      }.`;
    }
    if (
      blanks.slice(0, index).some((seen) =>
        isRecord(seen) && seen.row === row && seen.column === column
      )
    ) {
      return `a table needs each blank to be a distinct cell, and blanks[${index}] repeats row ${row}, column ${column}.`;
    }
  }
  return null;
}

function tableBlock(value: Args): Built {
  const { columns, rows, blanks = [], spans = [] } = value;
  if (!withinLimit(columns) || !withinLimit(rows)) {
    return `each column and cell must be at most ${MAX_TEXT} characters.`;
  }
  const problem = tableProblem(value);
  if (problem !== null) return problem;
  return { payload: { columns, rows, blanks, spans } };
}

/** [boxes] each under a new id, or null when they are not a list. */
function boxesOf(boxes: unknown, ids: IdSource): unknown[] | null {
  return Array.isArray(boxes)
    ? boxes.map((box: unknown) =>
      isRecord(box) ? { ...box, id: uuidV7(ids) } : box
    )
    : null;
}

const BOXES =
  "boxes must be a list of boxes, each with x, y, w and h as fractions from 0 to 1.";

/** A photo or sound the card already holds, given by its `media`: kept as stored, never fetched. */
function keptBlock(value: Args, ids: IdSource, kept: Kept): Built {
  const stored = typeof value.media === "string"
    ? kept.media.get(value.media)
    : undefined;
  if (stored === undefined || stored.type !== value.type) {
    return value.type === "image"
      ? "an image block by media must name a photo this card already holds, as list_cards returns it; give a new photo by url."
      : "an audio block must name a sound this card already holds by its media, as list_cards returns it; a new sound cannot be added.";
  }
  const { side } = value;
  if (stored.type === "audio") {
    return { payload: { ...stored.payload, side } };
  }
  const boxes = boxesOf(value.boxes ?? [], ids);
  if (boxes === null) return BOXES;
  return {
    payload: { ...stored.payload, boxes, ...(side !== undefined && { side }) },
  };
}

function imageBlock(value: Args, ids: IdSource): Built {
  const { url, boxes = [], side } = value;
  if (typeof url !== "string") {
    return "an image block needs url, the https address of a JPEG, PNG or WebP image.";
  }
  const stored = boxesOf(boxes, ids);
  if (stored === null) return BOXES;
  return {
    url,
    // A placeholder size and a new id: the fetch fills in the size once the card is otherwise valid.
    payload: {
      media: uuidV7(ids),
      width: 1,
      height: 1,
      boxes: stored,
      ...(side !== undefined && { side }),
    },
  };
}

function built(
  value: Args,
  ids: IdSource,
  kept: Kept | null,
  writes: Writes,
): Built {
  if (
    kept !== null &&
    (value.type === "audio" ||
      (value.type === "image" && value.url === undefined &&
        value.media !== undefined))
  ) return keptBlock(value, ids, kept);
  const type = BLOCK_TYPES.find((known) => known === value.type);
  switch (type) {
    case "text":
      return textBlock(value, writes);
    case "senses":
      return sensesBlock(value);
    case "cloze":
      return clozeBlock(value, writes);
    case "table":
      return tableBlock(value);
    case "image":
      return imageBlock(value, ids);
    case undefined:
      return `type must be text, senses, cloze, table or image, not ${
        JSON.stringify(value.type)
      }.`;
  }
}

/** What each type must hold, for a block the frame's reader refuses. */
const SHAPES: Record<string, string> = {
  text: "a text block needs a front or a back.",
  senses:
    "a senses block needs one or more senses, each with a meaning, and ask must be term or meaning.",
  cloze:
    "a cloze needs text with one ___ for each of its answers, each answer holding text; or text alone with a {{c1::answer}} in it.",
  table:
    "a table needs columns, rows of as many cells as columns, and a blank or a span: each blank a distinct cell holding text, each span a run of a cell's text that overlaps no other span and is in no blank cell.",
  image:
    "an image holds side, front or back, exactly while it holds no box, and each box needs x, y, w and h inside the image, as fractions from 0 to 1, and an optional text answer.",
  audio: "an audio block needs side, front or back.",
};

const PROBLEMS = {
  nothing_before:
    "the card shows nothing before the reveal: give a text a front, or a senses block the side ask names, or put a photo on the front, or add a cloze or a table.",
  nothing_added:
    "the card adds nothing at the reveal: give a text a back, or a senses block both a term and senses, or put a photo on the back, or add a cloze or a table.",
} as const;

function card(
  blocks: readonly StoredBlock[],
  photos: readonly PendingPhoto[],
  cells: readonly Cell[],
): ReadCard | string {
  const problem = frameProblem(cells);
  if (problem !== null) return PROBLEMS[problem];
  const key = frameKey(cells);
  return key === ""
    ? PROBLEMS.nothing_before
    : { blocks, photos, key, front: shownFirst(cells) };
}

/** A card of [values], or why it is refused, naming the block by its index. */
function readBlocks(
  values: unknown,
  ids: IdSource,
  kept: Kept | null,
  writes: Writes,
): ReadCard | string {
  if (
    !Array.isArray(values) || values.length === 0 ||
    values.length > MAX_BLOCKS
  ) {
    return `blocks must be a list of 1 to ${MAX_BLOCKS} blocks.`;
  }
  const blocks: StoredBlock[] = [];
  const photos: PendingPhoto[] = [];
  const cells: Cell[] = [];
  for (const [index, value] of values.entries()) {
    const where = `block ${index}: `;
    if (!isRecord(value)) return `${where}a block must be an object.`;
    const read = built(value, ids, kept, writes);
    if (typeof read === "string") return where + read;
    const type = value.type as string;
    const block = {
      type,
      v: read.v ?? FRAME_VERSIONS.get(type) ?? (type === "table" ? 2 : 1),
      id: keptId(value.id, type, kept, blocks) ?? uuidV7(ids),
      payload: read.payload,
    };
    const parsed = parseCells([block]);
    if (parsed === null) return where + SHAPES[type];
    blocks.push(block);
    cells.push(...parsed);
    if (read.url !== undefined) {
      photos.push({ media: read.payload.media as string, url: read.url });
    }
  }
  return card(blocks, photos, cells);
}

/** [id] when it is a stored block's of the card, of [type], not taken by an earlier block. */
function keptId(
  id: unknown,
  type: string,
  kept: Kept | null,
  taken: readonly StoredBlock[],
): string | null {
  return typeof id === "string" && kept?.ids.get(id) === type &&
      !taken.some((block) => block.id === id)
    ? id
    : null;
}

/** The plain form: one 글, or a 단어 when it has labels or examples. */
function readPlain(
  value: Args,
  ids: IdSource,
  kept: Kept | null,
  writes: Writes,
): ReadCard | string {
  const front = requiredText(value.front);
  if (front === null) {
    return `front must be text of 1 to ${MAX_TEXT} characters.`;
  }
  const back = requiredText(value.back);
  if (back === null) {
    return `back must be text of 1 to ${MAX_TEXT} characters.`;
  }
  const labels = texts(value.labels, "labels", MAX_LABELS);
  if (typeof labels === "string") return labels;
  const examples = texts(value.examples, "examples", MAX_EXAMPLES);
  if (typeof examples === "string") return examples;
  const senses = [{ labels, meaning: back, examples }];
  return readBlocks(
    [
      labels.length === 0 && examples.length === 0
        ? { type: "text", front, back }
        : { type: "senses", term: front, ask: "term", senses },
    ],
    ids,
    kept,
    writes,
  );
}

/**
 * A card of an `add_cards` or `update_cards` call, read, or the reason it is refused. [kept] is
 * what the card being updated holds: the block ids a block may keep, and its photos and sounds.
 */
export function readCard(
  value: unknown,
  ids: IdSource,
  kept: Kept | null = null,
  writes: Writes = { markup: false },
): ReadCard | string {
  if (!isRecord(value)) {
    return "the card must be an object with blocks, or with front and back.";
  }
  if ("blocks" in value) {
    return "front" in value || "back" in value
      ? "give a card blocks, or front and back, not both."
      : readBlocks(value.blocks, ids, kept, writes);
  }
  if (typeof value.type === "string") {
    return `a card is {"blocks":[...]}, a list of blocks, and this is a block of type ${value.type}: send {"blocks":[{"type":"${value.type}", ...}]}.`;
  }
  return readPlain(value, ids, kept, writes);
}

/** What a stored card holds that an update may keep. */
export type Kept = {
  /** Each stored 칸's type by its id. */
  readonly ids: ReadonlyMap<string, string>;
  /** Each stored photo's and sound's type and payload, without its side and boxes, by media id. */
  readonly media: ReadonlyMap<
    string,
    { readonly type: string; readonly payload: Args }
  >;
};

/** The ids of a `free` v2 card's 칸, in order; none for a card of two sides, whose 칸 are converted. */
export function storedIds(stored: StoredSides): (string | null)[] {
  return stored.template === "free" && stored.template_version === 2 &&
      Array.isArray(stored.front)
    ? stored.front.map((block: unknown) =>
      isRecord(block) && typeof block.id === "string" ? block.id : null
    )
    : [];
}

/** What [stored] holds that an update may keep. */
export function keptOf(stored: StoredSides): Kept {
  const ids = new Map<string, string>();
  const media = new Map<string, { type: string; payload: Args }>();
  const free = storedIds(stored);
  const blocks = [stored.front, stored.back].flatMap((side) =>
    Array.isArray(side) ? side.filter(isRecord) : []
  );
  for (const { type, id, payload } of blocks) {
    if (typeof type !== "string") continue;
    if (typeof id === "string" && free.includes(id)) ids.set(id, type);
    if (!isRecord(payload) || typeof payload.media !== "string") continue;
    if (type === "image") {
      const { media: name, width, height } = payload;
      media.set(name, { type, payload: { media: name, width, height } });
    } else if (type === "audio") {
      const { media: name, duration_ms } = payload;
      media.set(name, { type, payload: { media: name, duration_ms } });
    }
  }
  return { ids, media };
}
