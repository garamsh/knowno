import { v7 } from "uuid";
import { field } from "@/supabase/row";
import { block, type Block, type CardDraft, cardKey, holdsBack, textBlocks } from "./authoring";
import { describeContent, parseContent } from "./card-content";

/**
 * A photo's reviewed candidate retains its structured content until an explicit save: its front
 * and back as word to meaning, which its section's form turns (`section-form.ts`), the id of the
 * reversed card "양쪽 방향" adds, and the pronunciation and extras the form may show.
 */
export type Candidate = CardDraft & {
  topic: string;
  kind: "vocabulary" | "note";
  identify: boolean;
  pronunciation: string | null;
  extras: Extra[];
  reverseId: string;
  /** Included (true) or left out (false) by the user; null until either, when the list decides. */
  selected: boolean | null;
  /** Whether each meaning of the back's senses, in order, is kept; absent while all are. */
  keptSenses?: boolean[];
};
/** A note the page prints for a whole entry, such as a synonym, as the phone's `Extra`. */
export type Extra = { label: string; text: string };
/** The most cards the function answers a photo, over all its requests (ADR 0138). */
const maxPhotoCards = 500;
/**
 * Parses the function's current response and maps its fields as the phone does; a [resumed]
 * request's, one that sent a cursor, may hold no card.
 */
export function parseCandidates(body: unknown, resumed = false): Candidate[] | null {
  const cards = field(body, "cards");
  if (!Array.isArray(cards) || cards.length < (resumed ? 0 : 1) || cards.length > maxPhotoCards)
    return null;
  const result: Candidate[] = [];
  for (const raw of cards) {
    const card: unknown = raw;
    const front = field(card, "front");
    const answer = field(card, "answer");
    const topic = field(card, "topic");
    const kind = field(card, "kind");
    const type = field(card, "type");
    if (
      typeof front !== "string" ||
      !front.trim() ||
      Array.from(front).length > 500 ||
      typeof topic !== "string" ||
      Array.from(topic).length > 60 ||
      (kind !== "vocabulary" && kind !== "note")
    )
      return null;
    let frontBlocks = textBlocks(front);
    let back = typeof answer === "string" ? textBlocks(answer) : [];
    if (kind === "vocabulary") {
      if (type !== "concept") return null;
      back = [block("senses", { senses: field(card, "senses") })];
    } else if (type === "cloze") {
      const cloze = field(card, "cloze");
      frontBlocks = [block("cloze", { text: front, answers: field(cloze, "answers") })];
    } else if (type === "table") {
      const table = field(card, "table");
      frontBlocks.push(
        block("table", {
          columns: field(table, "columns"),
          rows: field(table, "rows"),
          blanks: field(table, "blanks"),
          spans: [],
        }),
      );
    } else if (type !== "concept" && type !== "identify") return null;
    const parsed = parseContent(frontBlocks);
    if (!parsed) return null;
    const whole = type === "cloze" || type === "table";
    if (whole) back = [];
    if (!parseContent(back) || (!whole && back.length === 0)) return null;
    const spoken = field(card, "pronunciation") ?? null;
    const pronunciation = spoken === null ? null : isText(spoken) ? spoken.trim() : undefined;
    const extras = parseExtras(field(card, "extras"));
    if (pronunciation === undefined || !extras) return null;
    result.push({
      id: v7(),
      topic,
      kind,
      identify: type === "identify",
      pronunciation,
      extras,
      reverseId: v7(),
      front: frontBlocks,
      back,
      selected: null,
    });
  }
  return mergeCandidates(result);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** A card's extras, each a non-empty label and text, trimmed, as the phone's `_parseExtra`; null otherwise. */
function parseExtras(value: unknown): Extra[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const extras: Extra[] = [];
  for (const extra of value) {
    const label = field(extra, "label");
    const text = field(extra, "text");
    if (!isText(label) || !isText(text)) return null;
    extras.push({ label: label.trim(), text: text.trim() });
  }
  return extras;
}

/**
 * [read] followed by those of [more] whose front none of [read] has, as the function compares the
 * fronts a request reads on past, and as the phone's job appends them.
 */
export function appendCandidates(read: Candidate[], more: Candidate[]): Candidate[] {
  const fronts = new Set(read.map((card) => keyOf(card.front)));
  return [...read, ...more.filter((card) => !fronts.has(keyOf(card.front)))];
}

/** [blocks]' key under the phone's card key normalization. */
function keyOf(blocks: Block[]): string {
  return cardKey(parseContent(blocks) ?? []);
}

/** Every sense of [side]'s senses blocks, as stored. */
function sensesOf(side: Block[]): unknown[] {
  return side.flatMap((item) => {
    const list: unknown = field(item.payload, "senses");
    return item.type === "senses" && Array.isArray(list) ? list.map((sense: unknown) => sense) : [];
  });
}

/**
 * One photo's candidates with each card key's merged into its first, as the phone's `ImportRow`:
 * a vocabulary entry's senses joined without repeats; a note's later back appended on a line of
 * its text unless the back already holds it, as the phone's `mergeBack`.
 */
function mergeCandidates(cards: Candidate[]): Candidate[] {
  const merged = new Map<string, Candidate>();
  for (const card of cards) {
    const key = keyOf(card.front);
    const first = merged.get(key);
    if (!first) merged.set(key, card);
    else if (first.kind === "vocabulary" && card.kind === "vocabulary") {
      const seen = new Set(sensesOf(first.back).map((sense) => JSON.stringify(sense)));
      const added = sensesOf(card.back).filter((sense) => !seen.has(JSON.stringify(sense)));
      const all = [...sensesOf(first.back), ...added];
      first.back = first.back.map((item) =>
        item.type === "senses" ? { ...item, payload: { senses: all } } : item,
      );
    } else if (
      first.kind === "note" &&
      !first.front.some((item) => item.type === "cloze" || item.type === "table")
    ) {
      const held = parseContent(first.back) ?? [];
      const back = describeContent(parseContent(card.back) ?? []);
      if (back.trim() && !holdsBack(held, back))
        first.back = textBlocks(`${describeContent(held)}\n${back}`);
    }
  }
  return [...merged.values()];
}
