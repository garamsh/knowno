import type { CardContent } from "./card-content";

/** A deck's id, as the phone created it. */
export type DeckId = string & { readonly brand: "DeckId" };

/** A card's id, as the phone created it. */
export type CardId = string & { readonly brand: "CardId" };

/** A uuid in the canonical lowercase form the server stores and returns ids in. */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** [value] as a deck's id, or null when it is not one: an address or a request names no deck. */
export function parseDeckId(value: unknown): DeckId | null {
  return typeof value === "string" && uuid.test(value) ? (value as DeckId) : null;
}

/** [value] as a card's id, or null when it is not one. */
export function parseCardId(value: unknown): CardId | null {
  return typeof value === "string" && uuid.test(value) ? (value as CardId) : null;
}

/** Where a note stands in publishing: private, being checked, held for an admin, refused, or public. */
export type Publication = "private" | "checking" | "held" | "refused" | "public";

/**
 * What a note's chip says in [publication], none for a private note; the owner sees a held note
 * as one being checked.
 */
export function publicationWord(publication: Publication): string | null {
  switch (publication) {
    case "private":
      return null;
    case "checking":
    case "held":
      return "확인 중";
    case "refused":
      return "공개 안 됨";
    case "public":
      return "공개";
  }
}

/** Whether [publication] is a note that is public or waiting to be, which "비공개로 전환" takes back. */
export function isOffered(publication: Publication): boolean {
  switch (publication) {
    case "public":
    case "checking":
    case "held":
      return true;
    case "private":
    case "refused":
      return false;
  }
}

/**
 * A deck that is not deleted, its [Publication], the keys of the icon and colour
 * its owner chose for its tile, absent while none is stored (ADR 0103), a signed URL its photo is
 * drawn from while it holds one the server lets it read (ADR 0159), and, on a note's page, the
 * description it is published with.
 */
export type Deck = {
  id: DeckId;
  name: string;
  publication: Publication;
  icon?: string;
  color?: string;
  imageUrl?: string;
  description?: string;
};

/**
 * A card that is not deleted, in a deck that is not, without its content: what the deck list
 * counts. Times are milliseconds since the epoch.
 */
export type CardEntry = { id: CardId; deckId: DeckId; createdAt: number };

/** A card with its 칸 and the two sides they read as. */
export type Card = CardEntry & CardContent;

/** The signed-in user's decks, by name, and their cards, oldest first. */
export type Library<C extends CardEntry = Card> = { decks: Deck[]; cards: C[] };
