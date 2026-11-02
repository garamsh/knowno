import type { Deck } from "./library";

/**
 * The deck palette's colours by the key a deck stores, in the app's order (`DeckColor` in
 * app/lib/deck/src/model.dart), each with its theme colour utility.
 */
const deckFills = {
  blue: "bg-deck-blue",
  sky: "bg-deck-sky",
  violet: "bg-deck-peach",
  amber: "bg-deck-amber",
  slate: "bg-deck-slate",
  sand: "bg-deck-sand",
} as const;

/** A colour of the deck palette, by the key a deck stores. */
export type DeckColor = keyof typeof deckFills;

/** The palette's colours, in the app's order. */
export const deckColors = Object.keys(deckFills) as DeckColor[];

/**
 * The four note colours a note is given, t1 to t4 (ADR 0147, ADR 0150). A note that stored sky or
 * amber keeps drawing it, and none is offered.
 */
export const offeredColors: readonly DeckColor[] = ["blue", "violet", "sand", "slate"];

/** The colour [deck]'s tile takes: the one it stores, or none for no key this version knows. */
export function deckColor(deck: Deck): DeckColor | undefined {
  const stored = deck.color;
  return stored !== undefined && Object.hasOwn(deckFills, stored)
    ? (stored as DeckColor)
    : undefined;
}

/** The theme colour utility of [color], or the brand tint with none chosen (ADR 0145). */
export function deckFill(color: DeckColor | undefined): string {
  return color ? deckFills[color] : "bg-brand-tint";
}
