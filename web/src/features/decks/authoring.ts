import { v7 } from "uuid";

import {
  type Cell,
  type CellSide,
  type CellSpan,
  clozeBlank,
  type Content,
  describeContent,
  frameProblem,
  type FrameProblem,
  frameVersions,
  isEarlier,
  isFramed,
  labelShown,
  parseCardContent,
  parseCells,
  parseContent,
  partsOfSpeech,
  plainText,
  type Rest,
  type Sense,
  type SenseLabel,
  sidesOf,
  type TableBlank,
  type WordAsk,
} from "./card-content";

/** Stored blocks accepted by the authoring boundary. */
export type Block = { type: string; v: number; id: string; payload: Record<string, unknown> };
/** A new card keeps its id across retries. */
export type CardDraft = { id: string; front: Block[]; back: Block[] };
/** A vocabulary meaning in the editor. */
export type Meaning = { labels: SenseLabel[]; meaning: string; examples: string[] };
/** The columns of a card a merge reads and writes, as they are stored. */
export type StoredCard = {
  front: unknown;
  back: unknown;
  template: unknown;
  templateVersion: unknown;
};

/** The phone's NFKC, whitespace and lowercase normalization of a card key. */
function normalizedKey(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}
/** The phone's duplicate key. */
export function cardKey(front: Content[]): string {
  return normalizedKey(describeContent(front));
}
/** The key of a card of [cells]: the text shown before the reveal, every blank filled, in 칸 order. */
export function frameKey(cells: Cell[]): string {
  return normalizedKey(plainText(sidesOf(cells).front));
}
/**
 * Whether a line of [side] holds [back] under the card key normalization, as the phone's
 * `mergeBack`, or each of [back]'s lines is held, as a back of several lines is once merged, so a
 * retried save does not append it again.
 */
export function holdsBack(side: Content[], back: string): boolean {
  const key = (text: string) => cardKey([{ kind: "text", text }]);
  const lines = new Set(plainText(side).split("\n").map(key));
  return lines.has(key(back)) || back.split("\n").every((line) => lines.has(key(line)));
}
/**
 * [stored] with [back] merged in, as the phone's `addCards` merges a duplicate, its other blocks
 * as stored: a 칸 list takes a 글 of a back alone; two sides take a text block on the back and
 * record `free` version 1, a later build's template kept. [stored] itself when there is nothing
 * to merge, and null when it cannot be read.
 */
export function mergeBack(stored: StoredCard, back: string): StoredCard | null {
  const framed = isFramed(stored.template, stored.templateVersion);
  const read = parseCardContent(stored);
  const side = framed ? read?.back : parseContent(stored.back);
  const list: unknown = framed ? stored.front : stored.back;
  if (!read || !side || !Array.isArray(list)) return null;
  if (back.trim() === "" || holdsBack(side, back)) return stored;
  const blocks: unknown[] = list;
  if (framed) {
    const payload = { front: "", back };
    const cell = { type: "text", v: frameVersions.get("text"), id: v7(), payload };
    return { ...stored, front: [...blocks, cell] };
  }
  return {
    ...stored,
    back: [...blocks, block("text", { text: back })],
    ...(isEarlier(stored.template, stored.templateVersion)
      ? { template: "free", templateVersion: 1 }
      : {}),
  };
}
/** A block at the version the phone writes. */
export function block(type: string, payload: Record<string, unknown>): Block {
  return { type, v: type === "table" ? 2 : 1, id: v7(), payload };
}
/** Plain text stored as a block, with empty text omitted. */
export function textBlocks(text: string): Block[] {
  return text.trim() ? [block("text", { text: text.trim() })] : [];
}
/** Typed labels, with the phone's short part-of-speech forms. */
export function labelsFromText(text: string): SenseLabel[] {
  return text
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((text): SenseLabel => {
      for (const [category, short] of Object.entries(partsOfSpeech)) {
        if (short === text && category in partsOfSpeech) {
          const entry = Object.keys(partsOfSpeech).find(
            (key): key is keyof typeof partsOfSpeech => key === category,
          );
          if (entry) return { kind: "part_of_speech", category: entry, text };
        }
      }
      return { kind: "other", category: null, text };
    });
}
/** A card of a list of 칸 on the wire: its id, and its 칸 as stored. */
export type CellsDraft = { id: string; blocks: Block[] };
/** A wire-format card of 칸 the frame's validity accepts, stored as `front` with an empty `back`. */
export function parseCellsDraft(value: unknown): CardDraft | null {
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string")
    return null;
  if (!("blocks" in value)) return null;
  const blocks = parseBlocks(value.blocks);
  const cells = blocks && parseCells(blocks);
  if (!blocks || !cells || cells.length === 0) return null;
  if (cells.some(({ kind }) => kind === "unknown") || frameProblem(cells) || !frameKey(cells))
    return null;
  return { id: value.id, front: blocks, back: [] };
}
/** What a card that breaks the frame's rule reads, as ADR 0137 words it. */
const frameMessages: Record<FrameProblem, string> = {
  nothing_before: "앞면에 보일 내용을 하나 이상 넣어 주세요",
  nothing_added: "뒷면이나 빈칸을 하나 이상 넣어 주세요",
};
/** The sentence refusing a wire-format card that breaks the frame's rule; null otherwise. */
export function frameRefusal(value: unknown): string | null {
  const blocks = value && typeof value === "object" && "blocks" in value ? value.blocks : null;
  const cells = parseCells(blocks);
  const problem = cells && frameProblem(cells);
  return problem ? frameMessages[problem] : null;
}
/** The files [cells] name: each photo's and sound's media id, with the kind of its block. */
export function mediaOf(cells: Cell[]): { media: string; kind: "image" | "audio" }[] {
  return cells.flatMap((cell) =>
    (cell.kind === "blank" || cell.kind === "placed") &&
    (cell.block.kind === "image" || cell.block.kind === "audio")
      ? [{ media: cell.block.media, kind: cell.block.kind }]
      : [],
  );
}
function parseBlocks(value: unknown): Block[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const result: Block[] = [];
  for (const raw of value) {
    const item: unknown = raw;
    if (
      !item ||
      typeof item !== "object" ||
      !("type" in item) ||
      typeof item.type !== "string" ||
      !("v" in item) ||
      typeof item.v !== "number" ||
      !("id" in item) ||
      typeof item.id !== "string" ||
      !("payload" in item) ||
      !item.payload ||
      typeof item.payload !== "object" ||
      Array.isArray(item.payload)
    )
      return null;
    const payload: Record<string, unknown> = Object.fromEntries(Object.entries(item.payload));
    result.push({ type: item.type, v: item.v, id: item.id, payload });
  }
  return result;
}
/** A 칸 this build writes: every kind but one it does not know, which opens read-only. */
export type WrittenCell = Exclude<Cell, { kind: "unknown" }>;

/** [block] of a 칸 with blanks or a placed 칸 as its stored payload. */
function storedPayload(block: Content): Record<string, unknown> {
  switch (block.kind) {
    case "cloze":
      return { text: block.text, answers: block.answers };
    case "table":
      return {
        columns: block.columns,
        rows: block.rows,
        blanks: block.blanks,
        spans: block.spans,
      };
    case "image":
      return {
        ...block.rest,
        media: block.media,
        width: block.width,
        height: block.height,
        boxes: block.boxes.map(({ id, x, y, w, h, answer, rest }) => ({
          ...rest,
          id,
          x,
          y,
          w,
          h,
          ...(answer !== null && { answer }),
        })),
      };
    case "audio":
      return { ...block.rest, media: block.media, duration_ms: block.durationMs };
    case "text":
    case "senses":
    case "unsupported":
      throw new Error(`a ${block.kind} block is not stored as a 칸's block`);
  }
}

/**
 * [cells] as the stored blocks `parseCells` reads, as the phone's `encodeCells`: a 칸 of no id takes
 * one from [newId], and each is written at the frame's version of its type when it has one.
 */
export function encodeCells(cells: WrittenCell[], newId: () => string = v7): Block[] {
  return cells.map((cell) => {
    const versioned = (type: string) => frameVersions.get(type) ?? block(type, {}).v;
    switch (cell.kind) {
      case "text":
        return {
          type: "text",
          v: versioned("text"),
          id: cell.id ?? newId(),
          payload: { front: cell.front, back: cell.back },
        };
      case "word":
        return {
          type: "senses",
          v: versioned("senses"),
          id: cell.id ?? newId(),
          payload: { term: cell.term, senses: cell.senses, ask: cell.ask },
        };
      case "blank":
      case "placed":
        return {
          type: cell.block.kind,
          v: versioned(cell.block.kind),
          id: cell.block.id ?? newId(),
          payload: {
            ...storedPayload(cell.block),
            ...(cell.kind === "placed" && { side: cell.side }),
          },
        };
    }
  });
}

/** A run of a line's text: its start and end in UTF-16 code units. */
export type Span = { start: number; end: number };

/** One meaning in the editor: its label as typed, and the labels it opened with. */
export type SenseDraft = {
  key: string;
  label: string;
  stored: SenseLabel[];
  meaning: string;
  examples: string;
  /** A sense stored with examples has their field. */
  withExamples: boolean;
};

/**
 * A file a 사진 or a 소리 names: its media id, the URL it is drawn or played from, and, until a
 * save stores it, the prepared file and its SHA-256 (ADR 0163).
 */
export type MediaFile = { media: string; url?: string; upload?: { file: Blob; sha256: string } };

/** A box over a photo in the editor: a stored box, its answer as typed (ADR 0109). */
export type BoxDraft = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  answer: string;
  rest?: Rest;
};

/** A photo as the editor holds it: its file, its pixels and its stored fields it does not know. */
export type PhotoDraft = MediaFile & { width: number; height: number; rest?: Rest };

/** A sound as the editor holds it: its file, its length and its stored fields it does not know. */
export type SoundDraft = MediaFile & { durationMs: number; rest?: Rest };

/** One 칸 in the editor. */
export type CellDraft =
  | { kind: "text"; id: string; front: string; back: string }
  | { kind: "word"; id: string; term: string; ask: WordAsk; senses: SenseDraft[] }
  | { kind: "cloze"; id: string; line: string; blanks: Span[] }
  | {
      kind: "table";
      id: string;
      columns: string[];
      rows: string[][];
      blanks: TableBlank[];
      spans: CellSpan[];
    }
  | { kind: "image"; id: string; side: CellSide; photo: PhotoDraft | null; boxes: BoxDraft[] }
  | { kind: "audio"; id: string; side: CellSide; sound: SoundDraft | null };

const labelText = (labels: SenseLabel[]) => labels.map(labelShown).join(" ");

function senseDraft(sense: Sense): SenseDraft {
  return {
    key: v7(),
    label: labelText(sense.labels),
    stored: sense.labels,
    meaning: sense.meaning,
    examples: sense.examples.join("\n"),
    withExamples: sense.examples.length > 0,
  };
}

/** A new meaning, empty. */
export function emptySense(): SenseDraft {
  return senseDraft({ labels: [], meaning: "", examples: [] });
}

/**
 * A new 칸 of [kind], empty; a table starts at two columns and two rows, and a 사진 or a 소리
 * holds no file yet and sits on the front.
 */
export function emptyCell(kind: CellDraft["kind"]): CellDraft {
  const id = v7();
  switch (kind) {
    case "image":
      return { kind, id, side: "front", photo: null, boxes: [] };
    case "audio":
      return { kind, id, side: "front", sound: null };
    case "text":
      return { kind, id, front: "", back: "" };
    case "word":
      return { kind, id, term: "", ask: "term", senses: [emptySense()] };
    case "cloze":
      return { kind, id, line: "", blanks: [] };
    case "table":
      return {
        kind,
        id,
        columns: ["", ""],
        rows: [
          ["", ""],
          ["", ""],
        ],
        blanks: [],
        spans: [],
      };
  }
}

/** A stored cloze as its line, each blank a span of its answer's text. */
function clozeLine(text: string, answers: string[]): { line: string; blanks: Span[] } {
  const blanks: Span[] = [];
  let line = "";
  text.split(clozeBlank).forEach((part, at) => {
    line += part;
    const answer = answers[at];
    if (answer !== undefined) {
      blanks.push({ start: line.length, end: line.length + answer.length });
      line += answer;
    }
  });
  return { line, blanks };
}

/** A stored 칸 as the editor opens it, keeping its block's id. */
export function cellDraft(cell: WrittenCell): CellDraft {
  switch (cell.kind) {
    case "text":
      return { kind: "text", id: cell.id ?? v7(), front: cell.front, back: cell.back };
    case "word":
      return {
        kind: "word",
        id: cell.id ?? v7(),
        term: cell.term,
        ask: cell.ask,
        senses: cell.senses.map(senseDraft),
      };
    case "blank":
    case "placed": {
      const { block: stored } = cell;
      const id = stored.id ?? v7();
      if (stored.kind === "cloze")
        return { kind: "cloze", id, ...clozeLine(stored.text, stored.answers) };
      if (stored.kind === "table")
        return {
          kind: "table",
          id,
          columns: stored.columns,
          rows: stored.rows,
          blanks: stored.blanks,
          spans: stored.spans,
        };
      const side = cell.kind === "placed" ? cell.side : "front";
      if (stored.kind !== "image" && stored.kind !== "audio")
        throw new Error(`a ${stored.kind} block is not a 칸 of its own`);
      const file = { media: stored.media, ...(stored.url && { url: stored.url }) };
      if (stored.kind === "image")
        return {
          kind: "image",
          id,
          side,
          photo: {
            ...file,
            width: stored.width,
            height: stored.height,
            ...(stored.rest && { rest: stored.rest }),
          },
          boxes: stored.boxes.map(({ answer, ...box }) => ({ ...box, answer: answer ?? "" })),
        };
      return {
        kind: "audio",
        id,
        side,
        sound: {
          ...file,
          durationMs: stored.durationMs,
          ...(stored.rest && { rest: stored.rest }),
        },
      };
    }
  }
}

/** The sentence under a 칸 that cannot be saved as it is; null once it can. */
export function cellProblem(draft: CellDraft): string | null {
  switch (draft.kind) {
    case "text":
      return null;
    case "image":
      return draft.photo ? null : "사진을 골라 주세요";
    case "audio":
      return draft.sound ? null : "소리를 넣어 주세요";
    case "word":
      return draft.senses.some(({ meaning }) => meaning.trim() === "")
        ? senseRequired(draft.senses)
        : null;
    case "cloze": {
      const { text, answers } = builtCloze(draft);
      if (answers.length === 0) return "빈칸을 하나 이상 넣어 주세요";
      return text.split(clozeBlank).length - 1 === answers.length ? null : "줄에서 ___를 빼 주세요";
    }
    case "table": {
      const filled = (blank: TableBlank) =>
        (draft.rows[blank.row]?.[blank.column] ?? "").trim() !== "";
      if (draft.blanks.length === 0 && builtSpans(draft).length === 0)
        return "빈칸으로 할 칸을 하나 이상 골라 주세요";
      return draft.blanks.every(filled) ? null : "빈칸으로 고른 칸에 내용을 적어 주세요";
    }
  }
}

/** What a meaning left empty reads: its own field's words, one meaning's or a numbered one's. */
export function senseRequired(senses: SenseDraft[]): string {
  return senses.length > 1 ? "뜻을 적어 주세요" : "내용을 적어 주세요";
}

/** The line with each blank holding text as `___`, and their answers in order. */
function builtCloze({ line, blanks }: Extract<CellDraft, { kind: "cloze" }>) {
  let text = "";
  let at = 0;
  const answers: string[] = [];
  const filled = blanks
    .filter(({ start, end }) => line.slice(start, end).trim() !== "")
    .sort((a, b) => a.start - b.start);
  for (const { start, end } of filled) {
    text += line.slice(at, start) + clozeBlank;
    answers.push(line.slice(start, end));
    at = end;
  }
  return { text: text + line.slice(at), answers };
}

/** The table's spans, each moved with its cell's trim and cut to it, as the phone saves them. */
function builtSpans({ rows, spans }: Extract<CellDraft, { kind: "table" }>): CellSpan[] {
  return spans.flatMap((span) => {
    const text = rows[span.row]?.[span.column] ?? "";
    const lead = text.length - text.trimStart().length;
    const trimmed = text.trim();
    const cut = (at: number) => Math.min(Math.max(at - lead, 0), trimmed.length);
    const [start, end] = [cut(span.start), cut(span.end)];
    return trimmed.slice(start, end).trim() === "" ? [] : [{ ...span, start, end }];
  });
}

const blockId = (id: string) => ({ id });

/** The 칸 [draft] saves as: null for a 글 left empty, which is not saved. */
function builtCell(draft: CellDraft): WrittenCell | null {
  switch (draft.kind) {
    case "text": {
      const part = (text: string) => (text.trim() === "" ? "" : text);
      const [front, back] = [part(draft.front), part(draft.back)];
      return front === "" && back === "" ? null : { kind: "text", front, back, id: draft.id };
    }
    case "word":
      return {
        kind: "word",
        id: draft.id,
        term: draft.term.trim(),
        ask: draft.ask,
        senses: draft.senses.map((sense) => ({
          labels:
            sense.label === labelText(sense.stored) ? sense.stored : labelsFromText(sense.label),
          meaning: sense.meaning.trim(),
          examples: sense.examples
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
        })),
      };
    case "cloze":
      return {
        kind: "blank",
        block: { kind: "cloze", ...builtCloze(draft), ...blockId(draft.id) },
      };
    case "table":
      return {
        kind: "blank",
        block: {
          kind: "table",
          columns: draft.columns.map((text) => text.trim()),
          rows: draft.rows.map((row) => row.map((text) => text.trim())),
          blanks: draft.blanks,
          spans: builtSpans(draft),
          ...blockId(draft.id),
        },
      };
    case "image": {
      if (!draft.photo) return null;
      const { media, width, height, rest } = draft.photo;
      const block: Content = {
        kind: "image",
        media,
        width,
        height,
        // A box's answer is trimmed, and left out while empty, as the phone saves it.
        boxes: draft.boxes.map(({ answer, ...box }) => ({
          ...box,
          answer: answer.trim() === "" ? null : answer.trim(),
        })),
        ...(rest && { rest }),
        ...blockId(draft.id),
      };
      return draft.boxes.length > 0
        ? { kind: "blank", block }
        : { kind: "placed", block, side: draft.side };
    }
    case "audio": {
      if (!draft.sound) return null;
      const { media, durationMs, rest } = draft.sound;
      return {
        kind: "placed",
        block: { kind: "audio", media, durationMs, ...(rest && { rest }), ...blockId(draft.id) },
        side: draft.side,
      };
    }
  }
}

/** The files [drafts] name that a save stores before it writes the card (ADR 0163). */
export function pendingUploads(
  drafts: CellDraft[],
): { media: string; kind: "image" | "audio"; file: Blob; sha256: string }[] {
  return drafts.flatMap((draft) => {
    const named =
      draft.kind === "image" ? draft.photo : draft.kind === "audio" ? draft.sound : null;
    return named?.upload && (draft.kind === "image" || draft.kind === "audio")
      ? [{ media: named.media, kind: draft.kind, ...named.upload }]
      : [];
  });
}

/**
 * What [drafts] save as, or why not: a sentence the whole card reads, or `cells` null when a 칸
 * says what it needs under itself. A 글 left empty is not saved and keeps nothing from saving.
 */
export function builtCells(drafts: CellDraft[]): {
  cells: WrittenCell[] | null;
  message: string | null;
} {
  if (drafts.some((draft) => cellProblem(draft))) return { cells: null, message: null };
  const cells = drafts.flatMap((draft) => builtCell(draft) ?? []);
  const problem = frameProblem(cells);
  return problem ? { cells: null, message: frameMessages[problem] } : { cells, message: null };
}

/** [spans] sorted, with [added] replacing those it overlaps. */
export function withSpan<S extends Span>(spans: S[], added: S): S[] {
  return [
    ...spans.filter((span) => span.end <= added.start || added.end <= span.start),
    added,
  ].sort((a, b) => a.start - b.start);
}

/** The span [selection] lies in, a caret at either of its ends included. */
export function spanAt<S extends Span>(spans: S[], selection: Span): S | undefined {
  return spans.find(({ start, end }) => start <= selection.start && selection.end <= end);
}

/**
 * [spans] after [before] became [after]: each span the change leaves whole moves with its text, and
 * one it touches goes, as the phone's blanks do. The span starting at [open], an empty blank being
 * typed in, takes what is typed.
 */
export function movedSpans<S extends Span>(
  before: string,
  after: string,
  spans: S[],
  open: number | null = null,
): S[] {
  let head = 0;
  const shorter = Math.min(before.length, after.length);
  while (head < shorter && before[head] === after[head]) head += 1;
  let tail = 0;
  while (
    tail < shorter - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail += 1;
  const changedEnd = before.length - tail;
  const shift = after.length - before.length;
  return spans.flatMap((span) => {
    if (span.start === open && span.start <= head && changedEnd <= span.end)
      return [{ ...span, end: span.end + shift }];
    if (span.end <= head) return [span];
    if (span.start >= changedEnd)
      return [{ ...span, start: span.start + shift, end: span.end + shift }];
    return [];
  });
}

/** The table with [text] in its cell, keeping the spans the edit leaves whole. */
export function withCellText<T extends Extract<CellDraft, { kind: "table" }>>(
  table: T,
  row: number,
  column: number,
  text: string,
): T {
  const before = table.rows[row]?.[column] ?? "";
  const inCell = (span: CellSpan) => span.row === row && span.column === column;
  return {
    ...table,
    rows: table.rows.map((cells, at) =>
      at === row ? cells.map((cell, index) => (index === column ? text : cell)) : cells,
    ),
    spans: [
      ...table.spans.filter((span) => !inCell(span)),
      ...movedSpans(before, text, table.spans.filter(inCell)),
    ],
  };
}

/**
 * The toolbar's "빈칸" on a table's cell: with text selected, that run becomes a span replacing the
 * spans it overlaps and the cell's whole blank, or a span it lies in turns back into text; with
 * none, the cell becomes a whole blank, dropping its spans, or a plain cell again.
 */
export function withBlankToggled<T extends Extract<CellDraft, { kind: "table" }>>(
  table: T,
  row: number,
  column: number,
  selection: Span,
): T {
  const inCell = (span: CellSpan) => span.row === row && span.column === column;
  const others = table.spans.filter((span) => !inCell(span));
  const mine = table.spans.filter(inCell);
  const isCell = (blank: TableBlank) => blank.row === row && blank.column === column;
  if (selection.start < selection.end) {
    const inside = spanAt(mine, selection);
    if (inside) return { ...table, spans: [...others, ...mine.filter((span) => span !== inside)] };
    const text = table.rows[row]?.[column] ?? "";
    if (text.slice(selection.start, selection.end).trim() === "") return table;
    return {
      ...table,
      blanks: table.blanks.filter((blank) => !isCell(blank)),
      spans: [...others, ...withSpan(mine, { row, column, ...selection })],
    };
  }
  return table.blanks.some(isCell)
    ? { ...table, blanks: table.blanks.filter((blank) => !isCell(blank)) }
    : { ...table, blanks: [...table.blanks, { row, column }], spans: others };
}

/** Whether the toolbar's "빈칸" is on for the cell, as the phone's button shows it. */
export function blankPressed(
  table: Extract<CellDraft, { kind: "table" }>,
  row: number,
  column: number,
  selection: Span,
): boolean {
  if (selection.start < selection.end)
    return !!spanAt(
      table.spans.filter((span) => span.row === row && span.column === column),
      selection,
    );
  return table.blanks.some((blank) => blank.row === row && blank.column === column);
}

/** The table without row [row], moving the blanks with their cells and dropping those removed. */
export function withoutRow<T extends Extract<CellDraft, { kind: "table" }>>(
  table: T,
  row: number,
): T {
  const moved = <B extends { row: number }>(items: B[]) =>
    items
      .filter((item) => item.row !== row)
      .map((item) => (item.row > row ? { ...item, row: item.row - 1 } : item));
  return {
    ...table,
    rows: table.rows.filter((_, at) => at !== row),
    blanks: moved(table.blanks),
    spans: moved(table.spans),
  };
}

/** The table without column [column], moving the blanks with their cells. */
export function withoutColumn<T extends Extract<CellDraft, { kind: "table" }>>(
  table: T,
  column: number,
): T {
  const moved = <B extends { column: number }>(items: B[]) =>
    items
      .filter((item) => item.column !== column)
      .map((item) => (item.column > column ? { ...item, column: item.column - 1 } : item));
  return {
    ...table,
    columns: table.columns.filter((_, at) => at !== column),
    rows: table.rows.map((cells) => cells.filter((_, at) => at !== column)),
    blanks: moved(table.blanks),
    spans: moved(table.spans),
  };
}
