/** The candidate cards a model returns, their JSON schema, and the parser that proves them. */

import {
  clozeNumbers,
  parseMarkup,
  unfinishedClozes,
} from "../_shared/markup.ts";

export const MAX_CARDS = 100;
export const MAX_FIELD_CHARS = 500;
export const MAX_ANSWER_CHARS = 1000;
export const MAX_EXAMPLES = 5;
export const MAX_TOPIC_CHARS = 60;
export const MAX_SENSES = 10;
export const MAX_SENSE_LABELS = 5;
export const MAX_EXTRAS = 10;
export const MAX_TABLE_COLUMNS = 8;
export const MAX_TABLE_ROWS = 20;
export const MAX_CLOZE_BLANKS = 10;

/** What a card was read from: an entry of a vocabulary page, or a point of notes. */
export const KINDS = ["vocabulary", "note"] as const;
export type CardKind = (typeof KINDS)[number];

/**
 * What a card asks: a named concept, rule or exception and its statement; a line of the page with
 * blanks and what fills each; a sentence the page prints with a word to judge, and its category;
 * or a whole table with the cells to recall as blanks.
 */
export const TYPES = ["concept", "cloze", "identify", "table"] as const;
export type CardType = (typeof TYPES)[number];

/** The parts of speech a label may name, a closed list common across languages (ADR 0075). */
export const PARTS_OF_SPEECH = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "preposition",
  "conjunction",
  "interjection",
  "determiner",
  "numeral",
  "particle",
  "auxiliary",
  "classifier",
  "phrase",
] as const;
export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number];

/** What a sense label is: a part of speech on the list, or any other label. */
export const LABEL_KINDS = ["part_of_speech", "other"] as const;

/**
 * A label the page prints for a sense, `text` as printed without its enclosing brackets: a part
 * of speech with its category, or any other label, such as a semantic class, with none.
 */
export type SenseLabel =
  | {
    readonly kind: "part_of_speech";
    readonly category: PartOfSpeech;
    readonly text: string;
  }
  | { readonly kind: "other"; readonly category: null; readonly text: string };

/** One meaning of a vocabulary entry, with the labels and examples the page prints for it. */
export type Sense = {
  readonly labels: readonly SenseLabel[];
  readonly meaning: string;
  readonly examples: readonly string[];
};

/** Anything else the page prints for a vocabulary entry, under the page's own label. */
export type Extra = { readonly label: string; readonly text: string };

/**
 * What every card carries, each text field plain, trimmed and non-empty. `type` is what the card
 * asks; `front` the headword or the name of the concept a note states; `answer` the fullest
 * answer the page supports; `topic` the name of the page section the card comes from.
 * `examples` are those the page prints, absent when it prints none.
 */
type SharedCard = {
  readonly type: CardType;
  readonly front: string;
  readonly answer: string;
  readonly topic: string;
  readonly examples?: readonly string[];
};

/**
 * A vocabulary entry: its `senses` in page order, and `extras` and `pronunciation` when the page
 * prints them. Its `answer` is composed from the senses (`composeAnswer`).
 */
export type VocabularyCard = SharedCard & {
  readonly kind: "vocabulary";
  readonly type: "concept" | "identify";
  readonly senses: readonly Sense[];
  readonly extras?: readonly Extra[];
  readonly pronunciation?: string;
};

/** A cell of a table card's `rows` to recall: its row and column, each counted from 0. */
export type TableBlank = { readonly row: number; readonly column: number };

/**
 * A table card's table as the page prints it: its column headers, its rows of cells, each row as
 * many as there are columns, and the cells to recall. A header or cell the page leaves empty is
 * "", and a blank is never an empty cell.
 */
export type Table = {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly blanks: readonly TableBlank[];
};

/** A cloze card's blanks: what fills each `{{cN::answer}}` of its front, in order. */
export type Cloze = { readonly answers: readonly string[] };

type NoteFields = SharedCard & { readonly kind: "note" };

/**
 * A point of notes. A cloze card carries its `cloze` and a table card its `table`, and each one's
 * `answer` is composed from them (`composeClozeAnswer`, `composeTableAnswer`).
 */
export type NoteCard =
  | (NoteFields & { readonly type: "concept" | "identify" })
  | (NoteFields & { readonly type: "cloze"; readonly cloze: Cloze })
  | (NoteFields & { readonly type: "table"; readonly table: Table });

export type Card = VocabularyCard | NoteCard;

const field = {
  type: "string",
  minLength: 1,
  maxLength: MAX_FIELD_CHARS,
} as const;
const nullableField = { ...field, type: ["string", "null"] } as const;
/** A table's header or cell, which may be empty where the page leaves it so. */
const cell = { type: "string", maxLength: MAX_FIELD_CHARS } as const;

/**
 * How the version 1 cloze wrote each blank. The model no longer writes it: a cloze card's front
 * holds Anki `{{cN::answer}}` spans (ADR 0254). It stays exported for the eval's samples, which
 * `tools/eval/shapes.ts` still builds in that form.
 */
export const CLOZE_BLANK = "___";

/** The keys of a card as the model writes it, in the schema's order. */
const MODEL_KEYS = [
  "kind",
  "type",
  "front",
  "answer",
  "topic",
  "senses",
  "extras",
  "pronunciation",
  "examples",
  "table",
  "cloze",
] as const;

/**
 * The structured-output schema sent to the model; `parseCard` enforces the same limits and,
 * beyond what a schema can say, which fields each kind fills: a vocabulary card has senses and
 * no answer, and a note an answer and no senses, extras or pronunciation; a table card its
 * `table`, a cloze card its `cloze`, and neither an answer. Strict structured outputs require every
 * key, so an absent answer, pronunciation, table or cloze is `null` and absent lists are empty.
 * Which cells a table holds, and where its blanks are, the parser checks. `OUTPUT_CONTRACT` states
 * every one of those rules to the model.
 */
export const cardsSchema = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      maxItems: MAX_CARDS,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...KINDS] },
          type: { type: "string", enum: [...TYPES] },
          front: field,
          answer: { ...nullableField, maxLength: MAX_ANSWER_CHARS },
          topic: { ...field, maxLength: MAX_TOPIC_CHARS },
          senses: {
            type: "array",
            maxItems: MAX_SENSES,
            items: {
              type: "object",
              properties: {
                labels: {
                  type: "array",
                  maxItems: MAX_SENSE_LABELS,
                  items: {
                    type: "object",
                    properties: {
                      kind: { type: "string", enum: [...LABEL_KINDS] },
                      category: {
                        anyOf: [
                          { type: "string", enum: [...PARTS_OF_SPEECH] },
                          { type: "null" },
                        ],
                      },
                      text: field,
                    },
                    required: ["kind", "category", "text"],
                    additionalProperties: false,
                  },
                },
                meaning: field,
                examples: {
                  type: "array",
                  maxItems: MAX_EXAMPLES,
                  items: field,
                },
              },
              required: ["labels", "meaning", "examples"],
              additionalProperties: false,
            },
          },
          extras: {
            type: "array",
            maxItems: MAX_EXTRAS,
            items: {
              type: "object",
              properties: { label: field, text: field },
              required: ["label", "text"],
              additionalProperties: false,
            },
          },
          pronunciation: nullableField,
          examples: { type: "array", maxItems: MAX_EXAMPLES, items: field },
          table: {
            anyOf: [{
              type: "object",
              properties: {
                columns: {
                  type: "array",
                  maxItems: MAX_TABLE_COLUMNS,
                  items: cell,
                },
                rows: {
                  type: "array",
                  maxItems: MAX_TABLE_ROWS,
                  items: {
                    type: "array",
                    maxItems: MAX_TABLE_COLUMNS,
                    items: cell,
                  },
                },
                blanks: {
                  type: "array",
                  maxItems: MAX_TABLE_COLUMNS * MAX_TABLE_ROWS,
                  items: {
                    type: "object",
                    properties: {
                      row: { type: "integer" },
                      column: { type: "integer" },
                    },
                    required: ["row", "column"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["columns", "rows", "blanks"],
              additionalProperties: false,
            }, { type: "null" }],
          },
          cloze: {
            anyOf: [{
              type: "object",
              properties: {
                answers: {
                  type: "array",
                  maxItems: MAX_CLOZE_BLANKS,
                  items: field,
                },
              },
              required: ["answers"],
              additionalProperties: false,
            }, { type: "null" }],
          },
        },
        required: [...MODEL_KEYS],
        additionalProperties: false,
      },
    },
  },
  required: ["cards"],
  additionalProperties: false,
} as const;

/**
 * What each field of `cardsSchema` holds, as the output contract states it to the model. It names
 * the material, never a photo, so any source the instructions describe can reuse it (ADR 0124).
 */
const FIELD_MEANINGS: Readonly<Record<(typeof MODEL_KEYS)[number], string>> = {
  kind:
    `"vocabulary" for an entry of a vocabulary list, glossary, bilingual table or dictionary: a word or phrase to learn and its meanings. "note" for any other point to learn.`,
  type:
    `what the card asks. "concept": the front names a term, concept, rule or exception, and the answer states it. "cloze": the front is a line or sentence of the material with each part to recall written as an Anki cloze, {{c1::answer}}, the number after c counting from 1 in order, one for each part, and "cloze" holds the answers in that order. "identify": the front is an example the material gives, with the item to judge in single quotes, and the answer is its category and the reason. "table": a whole table of the material on one card, in "table", with the cells to recall as blanks.`,
  front:
    `what the learner sees first. On a vocabulary card, the word or phrase being learned, exactly as written; on a "concept" note, the name of what it states; on a "cloze" or "identify" card, its line or sentence, a "cloze" card's with its {{c1::answer}} spans; on a "table" card, the table's name. A "concept", "cloze" or "identify" card's front is card text in the markup.`,
  answer:
    `what the learner recalls on a "concept" or "identify" note: the definition, rule, exception or judgment, in a sentence or a few, in the material's language, card text in the markup. Every other card's answer is composed from its "senses", "cloze" or "table", so it is null there.`,
  topic:
    `the name of the section of the material the card comes from: its heading without numbering, or the material's title where it has no headings. Cards of one section share one topic, written the same way.`,
  senses:
    `a vocabulary card's meanings, in the material's order, one per part of speech or numbered meaning, each {"labels": [...], "meaning": "...", "examples": [...]}. "labels" are the labels the material gives that meaning, in its order, as written and never inferred, and [] when it gives none: a part of speech is {"kind": "part_of_speech", "category": <its category>, "text": <as written>}, and any other label, such as a register or a semantic class, {"kind": "other", "category": null, "text": <as written>}, its text without the brackets around it. "meaning" is the translation or definition as written, without its labels or its number. "examples" are the sentences the material gives under that meaning.`,
  extras:
    `anything else the material gives for a vocabulary entry as a whole, such as a synonym, an antonym, a gender or a plural, each {"label": <the material's own label>, "text": <as written>}.`,
  pronunciation:
    `the pronunciation, transcription or reading the material gives a vocabulary entry, as written, or null.`,
  examples:
    `the example sentences, phrases or worked examples the material itself gives for the card, each copied exactly. An example under one of a vocabulary entry's meanings goes in that sense's "examples" instead.`,
  table:
    `a "table" card's table as the material gives it, {"columns": [...], "rows": [[...], ...], "blanks": [{"row": r, "column": c}, ...]}: "columns" its column headers left to right, the top-left corner included; "rows" its rows top to bottom, each its cells left to right, starting with the row's header; "blanks" the cells to recall, counted from 0 within "rows". A header or cell the material leaves empty is "". It is null on every other card.`,
  cloze:
    `a "cloze" card's blanks, {"answers": [...]}: what fills each {{cN::answer}} of its front, in order, one answer for each. It is null on every other card.`,
};

/**
 * Every rule `parseCard` checks a card against, each the sentence the output contract states it
 * in. A refusal names its rule, so a check the contract does not state cannot be written.
 */
export const CARD_RULES = {
  fields:
    `A card holds exactly the eleven fields above, each once, and no other; a field a card does not use is null or [] as stated.`,
  kind: `"kind" is "vocabulary" or "note".`,
  type: `"type" is "concept", "cloze", "identify" or "table".`,
  front: `"front" is 1 to ${MAX_FIELD_CHARS} characters.`,
  answer: `"answer" is null or 1 to ${MAX_ANSWER_CHARS} characters.`,
  topic: `"topic" is 1 to ${MAX_TOPIC_CHARS} characters.`,
  pronunciation:
    `"pronunciation" is null or 1 to ${MAX_FIELD_CHARS} characters.`,
  examples:
    `"examples" holds 0 to ${MAX_EXAMPLES} examples, each 1 to ${MAX_FIELD_CHARS} characters.`,
  senses:
    `"senses" holds 0 to ${MAX_SENSES} senses, each exactly "labels", "meaning" and "examples".`,
  sense_meaning: `A sense's "meaning" is 1 to ${MAX_FIELD_CHARS} characters.`,
  sense_examples:
    `A sense's "examples" holds 0 to ${MAX_EXAMPLES}, each 1 to ${MAX_FIELD_CHARS} characters.`,
  sense_labels:
    `A sense's "labels" holds 0 to ${MAX_SENSE_LABELS} labels, each exactly "kind", "category" and "text".`,
  label_text:
    `A label's "text" is 1 to ${MAX_FIELD_CHARS} characters once the brackets around it are left out.`,
  label_kind: `A label's "kind" is "part_of_speech", its "category" one of ${
    PARTS_OF_SPEECH.map((category) => `"${category}"`).join(", ")
  }, or "other", its "category" null.`,
  extras:
    `"extras" holds 0 to ${MAX_EXTRAS}, each exactly "label" and "text", each 1 to ${MAX_FIELD_CHARS} characters.`,
  table_fields: `"table" is null or exactly "columns", "rows" and "blanks".`,
  table_columns: `A table has 1 to ${MAX_TABLE_COLUMNS} columns.`,
  table_rows:
    `A table has 1 to ${MAX_TABLE_ROWS} rows, each exactly as many cells as there are columns.`,
  table_cells:
    `Every column header and cell is text of at most ${MAX_FIELD_CHARS} characters, "" where the material leaves it empty.`,
  table_blanks:
    `A table has 1 or more blanks, each exactly "row" and "column", whole numbers from 0.`,
  table_blank_cells:
    `Each blank names a cell of "rows" that holds text, and no cell is named twice.`,
  cloze_fields:
    `"cloze" is null or exactly "answers": 1 to ${MAX_CLOZE_BLANKS} answers, each 1 to ${MAX_FIELD_CHARS} characters.`,
  note_fields:
    `A "note" card's "senses" and "extras" are [] and its "pronunciation" is null.`,
  vocabulary_senses: `A "vocabulary" card has 1 or more senses.`,
  vocabulary_answer: `A "vocabulary" card's "answer" is null.`,
  vocabulary_type:
    `A "vocabulary" card's "type" is "concept" or "identify", and its "table" and "cloze" are null.`,
  table_card:
    `A "table" card has its "table", and its "answer" and "cloze" are null.`,
  cloze_card:
    `A "cloze" card has its "cloze", and its "answer" and "table" are null.`,
  cloze_blanks:
    `A "cloze" card's front holds exactly one finished {{cN::answer}} span for each of its answers, each number once, and no other {{ in it.`,
  concept_card:
    `A "concept" or "identify" note has its "answer", and its "table" and "cloze" are null.`,
} as const;

/** A rule of `CARD_RULES`, which a refused card breaks. */
export type CardRule = keyof typeof CARD_RULES;

/**
 * What the contract says of the text a card is written in: the markup every card of the app and the
 * web reads (ADR 0208, ADR 0254), so a card made from the reply is stored as written.
 */
export const CARD_TEXT =
  'The "front" and "answer" of a "concept", "cloze" or "identify" card are card text in this markup: **bold**, *italic*, `code`, and lists whose lines start with "- " or "1. ", each line on its own line. Where the material prints one of the characters \\ * _ ` { } : as itself, write a backslash before it, and before a "-" or a number and a full stop that starts a line and is not a list item. A cloze card hides each part to recall as {{c1::answer}}, then {{c2::answer}}, counting from 1, with a hint after the answer when the material gives one, {{c1::answer::hint}}, and never writes a blank as ___. Every other field is plain text.';

/**
 * The output contract, fixed in the function and sent after whichever prompt version is served,
 * so that no editable prompt leaves a rule of the parser unstated (ADR 0124).
 */
export const OUTPUT_CONTRACT = [
  "# Output contract",
  "",
  `This contract is fixed and comes with every version of the instructions above; where they differ, it decides the form of the output. Answer with JSON only, {"cards": [...]}, at most ${MAX_CARDS} cards, and an empty list when the material holds nothing to learn. A card that breaks a rule below is discarded.`,
  "",
  "## Fields",
  "",
  "Every card has these fields:",
  ...MODEL_KEYS.map((key) => `- "${key}": ${FIELD_MEANINGS[key]}`),
  "",
  "## Card text",
  "",
  CARD_TEXT,
  "",
  "## Rules",
  "",
  ...Object.values(CARD_RULES).map((rule) => `- ${rule}`),
].join("\n");

/** The model's instructions: the served prompt version's text, then the output contract. */
export function composeInstructions(
  prompt: string,
  contract: string = OUTPUT_CONTRACT,
): string {
  return `${prompt}\n\n${contract}`;
}

/** A sense's labels as printed, each in brackets, or undefined when it has none: `[명] [사물]`. */
function composeLabels(sense: Sense): string | undefined {
  return sense.labels.length === 0
    ? undefined
    : sense.labels.map((label) => `[${label.text}]`).join(" ");
}

/**
 * A vocabulary card's answer as text: one sense's meaning, or one line per sense, its labels
 * before its meaning.
 */
export function composeAnswer(senses: readonly Sense[]): string {
  if (senses.length === 1) return senses[0].meaning;
  return senses.map((sense) => {
    const labels = composeLabels(sense);
    return labels === undefined ? sense.meaning : `${labels} ${sense.meaning}`;
  }).join("\n");
}

/**
 * A cloze card's answer as text: what fills each blank, one line per blank in the front's order.
 */
export function composeClozeAnswer(cloze: Cloze): string {
  return cloze.answers.join("\n");
}

/**
 * A table card's answer as text: its column headers on the first line and then one line per row,
 * cells joined by " | ".
 */
export function composeTableAnswer(table: Table): string {
  return [table.columns, ...table.rows].map((cells) => cells.join(" | "))
    .join("\n");
}

/** Why `parseCard` refused a card: the rule of `CARD_RULES` it breaks. */
export class Refusal {
  constructor(readonly rule: CardRule) {}
}

/** A reply's cards that keep every rule, and the rule each dropped card broke, in reply order. */
export type ParsedReply = {
  readonly cards: readonly Card[];
  readonly dropped: readonly CardRule[];
};

/**
 * Parses a model's reply, keeping each card that keeps every rule and dropping the rest, or
 * returns null when the reply is not the schema's envelope: JSON of exactly `{cards}`, a list of
 * at most `MAX_CARDS`. Lengths count code points, as JSON Schema does.
 */
export function parseReply(reply: string): ParsedReply | null {
  let value: unknown;
  try {
    value = JSON.parse(reply);
  } catch {
    return null;
  }
  if (!isRecord(value) || !hasOnlyKeys(value, ["cards"])) return null;
  const items = value.cards;
  if (!Array.isArray(items) || items.length > MAX_CARDS) return null;
  const cards: Card[] = [];
  const dropped: CardRule[] = [];
  for (const item of items) {
    const card = parseCard(item);
    if (card instanceof Refusal) dropped.push(card.rule);
    else cards.push(card);
  }
  return { cards, dropped };
}

/**
 * A reply cut off at the output cap, closed after the last card its JSON completed: its text to the
 * end of that card, then `]}`, so that `parseReply` reads the cards before the cut by the same
 * rules (ADR 0135). Null when no card of the envelope's list was completed.
 */
export function closeCutReply(reply: string): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = 0; i < reply.length; i++) {
    const char = reply[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      // A card is an object inside the list inside the envelope.
      if (char === "}" && depth === 2) end = i + 1;
    }
  }
  return end === -1 ? null : `${reply.slice(0, end)}]}`;
}

/**
 * A reply's cards, or null when it is not the schema's or any card breaks a rule: the strict
 * reading, for a caller that takes a reply whole or not at all.
 */
export function parseCards(reply: string): Card[] | null {
  const parsed = parseReply(reply);
  return parsed === null || parsed.dropped.length > 0
    ? null
    : [...parsed.cards];
}

/** One card of a reply, each text field trimmed, or the rule it breaks. */
export function parseCard(item: unknown): Card | Refusal {
  if (!isRecord(item) || !hasOnlyKeys(item, MODEL_KEYS)) {
    return new Refusal("fields");
  }
  const kind = KINDS.find((known) => known === item.kind);
  if (kind === undefined) return new Refusal("kind");
  const type = TYPES.find((known) => known === item.type);
  if (type === undefined) return new Refusal("type");
  const front = text(item.front, MAX_FIELD_CHARS);
  if (front === null) return new Refusal("front");
  const answer = nullable(item.answer, MAX_ANSWER_CHARS);
  if (answer === undefined) return new Refusal("answer");
  const topic = text(item.topic, MAX_TOPIC_CHARS);
  if (topic === null) return new Refusal("topic");
  const pronunciation = nullable(item.pronunciation, MAX_FIELD_CHARS);
  if (pronunciation === undefined) return new Refusal("pronunciation");
  const senses = list(item.senses, MAX_SENSES, "senses", readSense);
  if (senses instanceof Refusal) return senses;
  const extras = list(item.extras, MAX_EXTRAS, "extras", parseExtra);
  if (extras instanceof Refusal) return extras;
  const examples = list(
    item.examples,
    MAX_EXAMPLES,
    "examples",
    (example) => text(example, MAX_FIELD_CHARS),
  );
  if (examples instanceof Refusal) return examples;
  const table = item.table === null ? null : parseTable(item.table);
  if (table instanceof Refusal) return table;
  const cloze = item.cloze === null ? null : parseCloze(item.cloze);
  if (cloze instanceof Refusal) return cloze;
  const shared = {
    front,
    topic,
    ...(examples.length === 0 ? {} : { examples }),
  };
  if (kind === "note") {
    if (senses.length > 0 || extras.length > 0 || pronunciation !== null) {
      return new Refusal("note_fields");
    }
    if (type === "table") {
      // A table card's answer is its table, composed.
      if (table === null || cloze !== null || answer !== null) {
        return new Refusal("table_card");
      }
      const composed = composeTableAnswer(table);
      return { ...shared, kind, type, answer: composed, table };
    }
    if (type === "cloze") {
      // A cloze card's answer is what fills its blanks, one for each {{cN::}} span of its front.
      if (cloze === null || table !== null || answer !== null) {
        return new Refusal("cloze_card");
      }
      if (
        unfinishedClozes(front) > 0 ||
        clozeNumbers(parseMarkup(front)).length !== cloze.answers.length
      ) {
        return new Refusal("cloze_blanks");
      }
      const composed = composeClozeAnswer(cloze);
      return { ...shared, kind, type, answer: composed, cloze };
    }
    if (answer === null || table !== null || cloze !== null) {
      return new Refusal("concept_card");
    }
    return { ...shared, kind, type, answer };
  }
  // A vocabulary entry's answer is composed from its senses; it is never a table or a cloze.
  if (senses.length === 0) return new Refusal("vocabulary_senses");
  if (answer !== null) return new Refusal("vocabulary_answer");
  if (
    table !== null || cloze !== null || type === "table" || type === "cloze"
  ) return new Refusal("vocabulary_type");
  return {
    ...shared,
    kind,
    type,
    answer: composeAnswer(senses),
    senses,
    ...(extras.length === 0 ? {} : { extras }),
    ...(pronunciation === null ? {} : { pronunciation }),
  };
}

/**
 * A table as the page prints it, or the rule it breaks: 1 to 8 columns, 1 to 20 rows of exactly
 * that many cells each, and 1 or more distinct blanks, each a cell inside the table that holds
 * text.
 */
function parseTable(value: unknown): Table | Refusal {
  if (!isRecord(value) || !hasOnlyKeys(value, ["columns", "rows", "blanks"])) {
    return new Refusal("table_fields");
  }
  if (
    !Array.isArray(value.columns) || value.columns.length === 0 ||
    value.columns.length > MAX_TABLE_COLUMNS
  ) return new Refusal("table_columns");
  if (
    !Array.isArray(value.rows) || value.rows.length === 0 ||
    value.rows.length > MAX_TABLE_ROWS
  ) return new Refusal("table_rows");
  const width = value.columns.length;
  if (
    value.rows.some((row) => !Array.isArray(row) || row.length !== width)
  ) return new Refusal("table_rows");
  const columns = list(value.columns, width, "table_cells", cellText);
  if (columns instanceof Refusal) return columns;
  const rows: string[][] = [];
  for (const row of value.rows) {
    const cells = list(row, width, "table_cells", cellText);
    if (cells instanceof Refusal) return cells;
    rows.push(cells);
  }
  const blanks = list(
    value.blanks,
    MAX_TABLE_COLUMNS * MAX_TABLE_ROWS,
    "table_blanks",
    parseTableBlank,
  );
  if (blanks instanceof Refusal) return blanks;
  if (blanks.length === 0) return new Refusal("table_blanks");
  const seen = new Set<string>();
  for (const { row, column } of blanks) {
    const at = `${row},${column}`;
    if (
      row >= rows.length || column >= columns.length || seen.has(at) ||
      rows[row][column] === ""
    ) return new Refusal("table_blank_cells");
    seen.add(at);
  }
  return { columns, rows, blanks };
}

function parseTableBlank(value: unknown): TableBlank | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["row", "column"])) return null;
  const { row, column } = value;
  return Number.isInteger(row) && Number.isInteger(column) &&
      (row as number) >= 0 && (column as number) >= 0
    ? { row: row as number, column: column as number }
    : null;
}

/** A cloze's 1 to 10 answers, or the rule it breaks. */
function parseCloze(value: unknown): Cloze | Refusal {
  if (!isRecord(value) || !hasOnlyKeys(value, ["answers"])) {
    return new Refusal("cloze_fields");
  }
  const answers = list(
    value.answers,
    MAX_CLOZE_BLANKS,
    "cloze_fields",
    (answer) => text(answer, MAX_FIELD_CHARS),
  );
  if (answers instanceof Refusal) return answers;
  return answers.length === 0 ? new Refusal("cloze_fields") : { answers };
}

/**
 * A sense of `{labels, meaning, examples}`, or null when it is not one: a label's `kind` unknown,
 * a part of speech without a category on the list, another label with a category, or a label,
 * meaning or example empty or over its limit. The eval reads its ground truth through it too.
 */
export function parseSense(value: unknown): Sense | null {
  const sense = readSense(value);
  return sense instanceof Refusal ? null : sense;
}

function readSense(value: unknown): Sense | Refusal {
  if (
    !isRecord(value) || !hasOnlyKeys(value, ["labels", "meaning", "examples"])
  ) return new Refusal("senses");
  const labels = list(
    value.labels,
    MAX_SENSE_LABELS,
    "sense_labels",
    parseLabel,
  );
  if (labels instanceof Refusal) return labels;
  const meaning = text(value.meaning, MAX_FIELD_CHARS);
  if (meaning === null) return new Refusal("sense_meaning");
  const examples = list(
    value.examples,
    MAX_EXAMPLES,
    "sense_examples",
    (example) => text(example, MAX_FIELD_CHARS),
  );
  if (examples instanceof Refusal) return examples;
  return { labels, meaning, examples };
}

/** The bracket pairs a page may enclose a label in, which its `text` leaves out. */
const LABEL_BRACKETS = [
  "[]",
  "()",
  "<>",
  "「」",
  "『』",
  "〈〉",
  "《》",
  "【】",
  "〔〕",
];

function parseLabel(value: unknown): SenseLabel | Refusal {
  if (!isRecord(value) || !hasOnlyKeys(value, ["kind", "category", "text"])) {
    return new Refusal("sense_labels");
  }
  const printed = text(value.text, MAX_FIELD_CHARS);
  if (printed === null) return new Refusal("label_text");
  // A label written with its brackets keeps only what they enclose.
  const brackets = LABEL_BRACKETS.find(([open, close]) =>
    printed.startsWith(open) && printed.endsWith(close)
  );
  const labelText = brackets === undefined
    ? printed
    : text(printed.slice(1, -1), MAX_FIELD_CHARS);
  if (labelText === null) return new Refusal("label_text");
  if (value.kind === "other" && value.category === null) {
    return { kind: "other", category: null, text: labelText };
  }
  const category = PARTS_OF_SPEECH.find((known) => known === value.category);
  return value.kind === "part_of_speech" && category !== undefined
    ? { kind: "part_of_speech", category, text: labelText }
    : new Refusal("label_kind");
}

export function parseExtra(value: unknown): Extra | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["label", "text"])) return null;
  const label = text(value.label, MAX_FIELD_CHARS);
  const extra = text(value.text, MAX_FIELD_CHARS);
  return label === null || extra === null ? null : { label, text: extra };
}

/**
 * Each element of [value] parsed, or the rule it breaks: [rule] when it is not a list of at most
 * [max] or an element is null, or the element's own refusal.
 */
function list<T>(
  value: unknown,
  max: number,
  rule: CardRule,
  parse: (element: unknown) => T | Refusal | null,
): T[] | Refusal {
  if (!Array.isArray(value) || value.length > max) return new Refusal(rule);
  const parsed: T[] = [];
  for (const element of value) {
    const one = parse(element);
    if (one === null) return new Refusal(rule);
    if (one instanceof Refusal) return one;
    parsed.push(one);
  }
  return parsed;
}

/** A table's header or cell trimmed, empty where the page leaves it so, or null when not text. */
function cellText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return [...trimmed].length <= MAX_FIELD_CHARS ? trimmed : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const length = [...trimmed].length;
  return length >= 1 && length <= max ? trimmed : null;
}

/** [value] as text, null for JSON null, or undefined when it is neither. */
function nullable(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  return text(value, max) ?? undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const present = Object.keys(record);
  return present.length === keys.length &&
    keys.every((key) => Object.hasOwn(record, key));
}
