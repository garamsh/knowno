import { field } from "@/supabase/row";
import { type Block, type CardDraft, type CellsDraft, encodeCells } from "./authoring";
import { escapeLiteral } from "@/design/markup-engine";
import { cellsFromSides, parseContent, textCell } from "./card-content";
import type { Candidate } from "./photo-candidates";

/** Which cards a vocabulary row makes, as the phone's `Direction`: word to meaning, meaning to word, or both. */
export type Direction = "forward" | "backward" | "both";

/**
 * How the cards of one section read, as the phone's `SectionForm`: a vocabulary section's
 * direction and what its meanings show, or whether a note section's front and back are swapped.
 */
export type SectionForm =
  | {
      kind: "vocabulary";
      direction: Direction;
      firstSenseOnly: boolean;
      showPos: boolean;
      showPronunciation: boolean;
      showExtras: boolean;
    }
  | { kind: "note"; swapped: boolean };

/** The form a section starts in: word to meaning with every sense and its labels, or a note as given. */
export function defaultForm(kind: Candidate["kind"], identify: boolean): SectionForm {
  return kind === "vocabulary" && !identify
    ? {
        kind: "vocabulary",
        direction: "forward",
        firstSenseOnly: false,
        showPos: true,
        showPronunciation: false,
        showExtras: false,
      }
    : { kind: "note", swapped: false };
}

/** The words the section's menu button shows for [form], `app_ko.arb`'s. */
export function formLabel(form: SectionForm): string {
  if (form.kind === "note") return form.swapped ? "앞면에 답" : "앞면에 질문";
  return { forward: "앞면에 단어", backward: "앞면에 뜻", both: "양쪽 방향" }[form.direction];
}

/** Whether [card]'s front holds a table or a cloze, which is saved whole in any form (ADR 0068). */
export function isWhole(card: CardDraft): boolean {
  return card.front.some((item) => item.type === "table" || item.type === "cloze");
}

/**
 * The meaning side: each senses block with its kept senses, the first alone when the form asks,
 * and without their part-of-speech labels when the form hides them, their other labels kept.
 */
function meaning(card: Candidate, form: Extract<SectionForm, { kind: "vocabulary" }>): Block[] {
  return card.back.map((item) => {
    const senses = field(item.payload, "senses");
    if (item.type !== "senses" || !Array.isArray(senses)) return item;
    const kept = senses.filter((_, at) => card.keptSenses?.[at] !== false);
    const shown: unknown[] = form.firstSenseOnly ? kept.slice(0, 1) : kept;
    return {
      ...item,
      payload: {
        ...item.payload,
        senses: shown.map((sense) => {
          const labels = field(sense, "labels");
          return form.showPos || !Array.isArray(labels) || typeof sense !== "object"
            ? sense
            : {
                ...sense,
                labels: labels.filter((label) => field(label, "kind") !== "part_of_speech"),
              };
        }),
      },
    };
  });
}

/** The lines of what [form] shows of [card]'s pronunciation and extras (ADR 0075). */
function addedLines(card: Candidate, form: Extract<SectionForm, { kind: "vocabulary" }>): string {
  return [
    ...(form.showPronunciation && card.pronunciation ? [card.pronunciation] : []),
    ...(form.showExtras ? card.extras.map(({ label, text }) => `${label} ${text}`) : []),
  ].join("\n");
}

/**
 * [front] and [back] as the stored 칸 of one card, as a card of two sides converts (ADR 0137), then
 * a 글 of a back alone of [added] when it holds any. No 칸 for a side an edit left unreadable, which
 * the save refuses.
 */
function blocksOf(front: Block[], back: Block[], added = ""): Block[] {
  const [before, after] = [parseContent(front), parseContent(back)];
  const cells = before && after ? cellsFromSides(before, after) : null;
  if (!cells) return [];
  return encodeCells([
    ...cells.filter((cell) => cell.kind !== "unknown"),
    ...(added ? [textCell("", escapeLiteral(added))] : []),
  ]);
}

/**
 * The cards [card] saves in [form], as the phone's `ImportRow.cards`, each its stored 칸: a table
 * or cloze card alone in any form; a vocabulary entry's 단어, asking its word, its meaning, or both
 * under the second's own id, with a 글 of a back alone of its pronunciation and extras when shown;
 * a note's 글 as given or swapped.
 */
export function cardsOf(card: Candidate, form: SectionForm): CellsDraft[] {
  const { id, reverseId, front, back } = card;
  if (isWhole(card)) return [{ id, blocks: blocksOf(front, back) }];
  if (form.kind === "vocabulary" && card.kind === "vocabulary") {
    const senses = meaning(card, form);
    const added = addedLines(card, form);
    const forward = { id, blocks: blocksOf(front, senses, added) };
    const backward = (id: string) => ({ id, blocks: blocksOf(senses, front, added) });
    if (form.direction === "forward") return [forward];
    if (form.direction === "backward") return [backward(id)];
    return [forward, backward(reverseId)];
  }
  return [
    {
      id,
      blocks: form.kind === "note" && form.swapped ? blocksOf(back, front) : blocksOf(front, back),
    },
  ];
}

/** The candidates of one topic of one photo, of one kind, identify cards apart, as the phone's `ImportSection`. */
export type Section = {
  /** Unique within the import: the photo's id and [key]. */
  id: string;
  /** The key its form is remembered under within a deck, the phone's `formKey`. */
  key: string;
  topic: string;
  kind: Candidate["kind"];
  identify: boolean;
  cards: Candidate[];
};

/** A photo's sections, in the order each first appears among its [cards]. */
export function sectionsOf(photo: string, cards: Candidate[]): Section[] {
  const sections = new Map<string, Section>();
  for (const card of cards) {
    const key = `${card.identify ? "identify:" : ""}${card.kind}:${card.topic}`;
    const section = sections.get(key);
    if (section) section.cards.push(card);
    else
      sections.set(key, {
        id: `${photo}|${key}`,
        key,
        topic: card.topic,
        kind: card.kind,
        identify: card.identify,
        cards: [card],
      });
  }
  return [...sections.values()];
}

/** [json] as a form for [section] when it is one of the section's kind, as the phone's `applyTo` takes it. */
export function formFor(section: Section, json: unknown): SectionForm | null {
  const form = parseForm(json);
  return form && form.kind === defaultForm(section.kind, section.identify).kind ? form : null;
}

/** The form [json] stores, as the phone's `SectionForm.fromJson` reads it; null when it is not one. */
export function parseForm(json: unknown): SectionForm | null {
  const direction = field(json, "direction");
  const flags = ["firstSenseOnly", "showPos", "showPronunciation", "showExtras"].map((key) =>
    field(json, key),
  );
  if (direction === "forward" || direction === "backward" || direction === "both") {
    const [firstSenseOnly, showPos, showPronunciation, showExtras] = flags;
    if (
      typeof firstSenseOnly === "boolean" &&
      typeof showPos === "boolean" &&
      typeof showPronunciation === "boolean" &&
      typeof showExtras === "boolean"
    )
      return {
        kind: "vocabulary",
        direction,
        firstSenseOnly,
        showPos,
        showPronunciation,
        showExtras,
      };
    return null;
  }
  const swapped = field(json, "swapped");
  return typeof swapped === "boolean" ? { kind: "note", swapped } : null;
}

/** [form] as the phone's `SectionForm.toJson` stores it. */
function formJson(form: SectionForm): Record<string, unknown> {
  if (form.kind === "note") return { swapped: form.swapped };
  const { direction, firstSenseOnly, showPos, showPronunciation, showExtras } = form;
  return { direction, firstSenseOnly, showPos, showPronunciation, showExtras };
}

/** The browser's key for the remembered forms: deck id, then section key, then form, as the phone stores them. */
const storageKey = "smartman.photoImportForms";

/** Every remembered form, deck id to section key to stored form; none when storage is absent or holds no such map. */
export function readForms(): Record<string, Record<string, unknown>> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(localStorage.getItem(storageKey) ?? "null");
  } catch {
    return {};
  }
  if (typeof decoded !== "object" || decoded === null) return {};
  return Object.fromEntries(
    Object.entries(decoded).flatMap(([deck, sections]: [string, unknown]) =>
      typeof sections === "object" && sections !== null && !Array.isArray(sections)
        ? [[deck, Object.fromEntries(Object.entries(sections))]]
        : [],
    ),
  );
}

/**
 * Remembers [forms], section key to form, for [deck] over what is stored; a browser that refuses
 * the write keeps the forms only for this import.
 */
export function rememberForms(deck: string, forms: Record<string, SectionForm>) {
  const stored = readForms();
  stored[deck] = {
    ...stored[deck],
    ...Object.fromEntries(Object.entries(forms).map(([key, form]) => [key, formJson(form)])),
  };
  try {
    localStorage.setItem(storageKey, JSON.stringify(stored));
  } catch {
    // Storage may be full or blocked; the cards are saved either way.
  }
}
