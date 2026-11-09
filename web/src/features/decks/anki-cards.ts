import { type WrittenCell } from "./authoring";
import { fieldMarkup } from "./anki-html";
import type { AnkiDeck, AnkiNote, NoteKind } from "./anki-package";
import { frameProblem, marksOf } from "./card-content";
import { clozeNumbers, markedOf } from "@/design/markup-engine";

/** A note's card as Anki's fields give it: markup, and the names of the images each side shows. */
export type AnkiCard = {
  noteId: number;
  kind: NoteKind;
  front: string;
  back: string;
  frontImages: string[];
  backImages: string[];
};
/** A photo stored for an image of the package: its media id and its size in pixels. */
export type Photo = { media: string; width: number; height: number };
/** A note of the package as knowno's note: its name and the cards its Anki notes make. */
export type ImportedDeck = {
  name: string;
  cards: AnkiCard[];
  /** Notes that make no card: a side with nothing to show, or a Cloze with no deletion. */
  skipped: number;
  /** Cards converted from a note type that is neither Basic nor Cloze (ADR 0222). */
  converted: number;
};

/** A deck's name as knowno's note name: `::` between Anki's parent and child is " / ", at most 500 long. */
export function noteName(name: string): string {
  return Array.from(name.split("::").join(" / ")).slice(0, 500).join("");
}

/** The card a note makes, or null where it makes none. */
export function cardOfNote(note: AnkiNote): AnkiCard | null {
  const [first = "", second = ""] = note.fields;
  if (note.kind === "cloze") {
    const text = fieldMarkup(first, true);
    if (!text || clozeNumbers(text.markup).length === 0) return null;
    // The Extra field is dropped, with the images in it.
    return {
      noteId: note.id,
      kind: note.kind,
      front: text.markup,
      back: "",
      frontImages: text.images,
      backImages: [],
    };
  }
  const front = fieldMarkup(first);
  const back = fieldMarkup(second);
  if (!front || !back) return null;
  const shows = (side: { markup: string; images: string[] }) =>
    side.markup !== "" || side.images.length > 0;
  if (!shows(front) || !shows(back)) return null;
  return {
    noteId: note.id,
    kind: note.kind,
    front: front.markup,
    back: back.markup,
    frontImages: front.images,
    backImages: back.images,
  };
}

/** The cards of [deck]'s notes, counting those made from other note types and those left out. */
export function importedDeck(deck: AnkiDeck): ImportedDeck {
  const cards: AnkiCard[] = [];
  for (const note of deck.notes) {
    const card = cardOfNote(note);
    if (card) cards.push(card);
  }
  return {
    name: noteName(deck.name),
    cards,
    skipped: deck.notes.length - cards.length,
    converted: cards.filter((card) => card.kind === "other").length,
  };
}

/** The names of the package's images the cards of [decks] show, each once, in order. */
export function imagesOf(decks: ImportedDeck[]): string[] {
  return [
    ...new Set(
      decks.flatMap(({ cards }) => cards.flatMap((c) => [...c.frontImages, ...c.backImages])),
    ),
  ];
}

const photoCell = (photo: Photo, side: "front" | "back"): WrittenCell => ({
  kind: "placed",
  block: { kind: "image", media: photo.media, width: photo.width, height: photo.height, boxes: [] },
  side,
});

/**
 * [card] as a card's 칸: its front's photos, its text, its back's photos. A photo the package did
 * not hold or that could not be stored is left out; a card with nothing left on a side is null.
 */
export function cellsOf(
  card: AnkiCard,
  photos: ReadonlyMap<string, Photo | null>,
): WrittenCell[] | null {
  const placed = (names: string[], side: "front" | "back") =>
    names.flatMap((name) => {
      const photo = photos.get(name);
      return photo ? [photoCell(photo, side)] : [];
    });
  const front = placed(card.frontImages, "front");
  const back = placed(card.backImages, "back");
  const cells: WrittenCell[] =
    card.kind === "cloze"
      ? [
          ...front,
          {
            kind: "blank",
            block: { kind: "cloze", text: card.front, answers: [], markup: markedOf(card.front) },
          },
        ]
      : [
          ...front,
          ...(card.front === "" && card.back === ""
            ? []
            : [
                {
                  kind: "text" as const,
                  front: card.front,
                  back: card.back,
                  marks: marksOf(card.front, card.back),
                },
              ]),
          ...back,
        ];
  return frameProblem(cells) === null ? cells : null;
}
