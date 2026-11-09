import "server-only";

// Importing this lets the server read card text through the engine (ADR 0209).
import "@/design/markup-engine-server";
import { requestTimeoutMs, type ServerFailure } from "@/supabase/failure";
import { selectAll } from "@/supabase/select-all";
import { field, parseTime } from "@/supabase/row";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";

import { type Content, parseCardContent } from "./card-content";
import type { Card, CardEntry, CardId, Deck, DeckId, Library } from "./library";
import { type MediaId, parseMediaId, signMedia } from "./media";

/** How long a deck's signed photo URL stays valid, in seconds. */
const imageUrlSeconds = 60 * 60;
/** How long a card's signed photo or sound URL stays valid, in seconds: past a study session. */
const cardMediaSeconds = 4 * 60 * 60;

/** Why the library could not be read: a server failure, or a row this version cannot read. */
export type LibraryFailure = ServerFailure | "unreadable";

/**
 * The decks [decks] names, or every deck, of the signed-in user, with their descriptions, their
 * cards and both sides of each; see [readDeckList] for what both reads leave out. Each card's
 * photos and sounds carry a URL signed for the user in one request (ADR 0163), which the note
 * page, the editor and study draw and play them from; one Storage does not sign, and every one
 * when signing fails, has none and is drawn as its frame, as the phone draws a file it cannot read.
 */
export function readLibrary(
  decks?: readonly DeckId[],
): Promise<{ library: Library } | { failure: LibraryFailure }> {
  return read(
    "id, deck_id, front, back, template, template_version, created_at",
    parseCard,
    decks,
    true,
    signCards,
  );
}

/** [cards] with each photo and sound's URL from [sign]. */
async function signCards(
  cards: Card[],
  sign: (ids: string[], seconds: number) => Promise<Map<string, string>>,
): Promise<Card[]> {
  const named = (blocks: Content[]) =>
    blocks.flatMap((block) =>
      block.kind === "image" || block.kind === "audio" ? [block.media] : [],
    );
  const signed = await sign(
    cards.flatMap((card) => named([...card.front, ...card.back])),
    cardMediaSeconds,
  );
  if (signed.size === 0) return cards;
  const drawn = (block: Content): Content => {
    const url = (block.kind === "image" || block.kind === "audio") && signed.get(block.media);
    return url ? { ...block, url } : block;
  };
  return cards.map((card) => ({
    ...card,
    front: card.front.map(drawn),
    back: card.back.map(drawn),
    cells: card.cells.map((cell) =>
      cell.kind === "text" || cell.kind === "word" ? cell : { ...cell, block: drawn(cell.block) },
    ),
  }));
}

/**
 * Every deck of the signed-in user, with its cards but not their content: what the deck list
 * shows and counts. Both reads run under row-level security and leave out every tombstoned row
 * and every card of a tombstoned deck. Row-level security also lets a user read other users'
 * public decks, so they filter on the user's own. A deck's photo is drawn from a URL signed for
 * the user (ADR 0159); one that cannot be signed leaves its tile the icon, as on the phone.
 */
export function readDeckList(): Promise<
  { library: Library<CardEntry> } | { failure: LibraryFailure }
> {
  return read("id, deck_id, created_at", parseCardEntry);
}

async function read<C extends CardEntry>(
  cardColumns: string,
  parse: (row: unknown) => C | null,
  decks?: readonly DeckId[],
  described = false,
  sign?: (
    cards: C[],
    sign: (ids: string[], seconds: number) => Promise<Map<string, string>>,
  ) => Promise<C[]>,
): Promise<{ library: Library<C> } | { failure: LibraryFailure }> {
  const supabase = await createClient();
  const session = await readUserId(supabase);
  if ("failure" in session) return session;
  const { userId } = session;
  const [deckRows, cardRows] = await Promise.all([
    selectAll((from, to, counted) => {
      const query = supabase
        .from("decks")
        .select(
          `id, name, publication, icon, color, image_media_id${described ? ", description" : ""}`,
          counted ? { count: "exact" } : {},
        )
        .eq("user_id", userId)
        .is("deleted_at", null);
      return (decks ? query.in("id", decks) : query)
        .order("id")
        .range(from, to)
        .abortSignal(AbortSignal.timeout(requestTimeoutMs));
    }),
    selectAll((from, to, counted) => {
      const query = supabase
        .from("cards")
        .select(cardColumns, counted ? { count: "exact" } : {})
        .eq("user_id", userId)
        .is("deleted_at", null);
      return (decks ? query.in("deck_id", decks) : query)
        .order("id")
        .range(from, to)
        .abortSignal(AbortSignal.timeout(requestTimeoutMs));
    }),
  ]);
  if ("failure" in deckRows) return deckRows;
  if ("failure" in cardRows) return cardRows;

  const images = new Map<string, MediaId>();
  for (const row of deckRows.rows) {
    const image = parseMediaId(field(row, "image_media_id"));
    const id = field(row, "id");
    if (image && typeof id === "string") images.set(id, image);
  }
  const signed = await signMedia(supabase, userId, [...images.values()], imageUrlSeconds);
  const liveDecks: Deck[] = [];
  for (const row of deckRows.rows) {
    const deck = parseDeck(row);
    if (!deck) return { failure: "unreadable" };
    const image = images.get(deck.id);
    const imageUrl = image && signed.get(image);
    liveDecks.push(imageUrl ? { ...deck, imageUrl } : deck);
  }
  const live = new Set(liveDecks.map((deck) => deck.id));
  const cards: C[] = [];
  for (const row of cardRows.rows) {
    const card = parse(row);
    if (!card) return { failure: "unreadable" };
    if (live.has(card.deckId)) cards.push(card);
  }
  // The phone's orders: decks by name, cards by creation; ties by id, so every read agrees.
  liveDecks.sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id));
  cards.sort((a, b) => a.createdAt - b.createdAt || compare(a.id, b.id));
  const drawn = sign
    ? await sign(cards, (ids, seconds) => signMedia(supabase, userId, ids, seconds))
    : cards;
  return { library: { decks: liveDecks, cards: drawn } };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function parseDeck(row: unknown): Deck | null {
  const id = field(row, "id");
  const name = field(row, "name");
  const publication = field(row, "publication");
  if (typeof id !== "string" || typeof name !== "string") return null;
  if (
    publication !== "private" &&
    publication !== "public" &&
    publication !== "checking" &&
    publication !== "held" &&
    publication !== "refused"
  ) {
    return null;
  }
  // A key the tile does not know draws the default, so neither key makes a row unreadable.
  const icon = field(row, "icon");
  const color = field(row, "color");
  const description = field(row, "description");
  return {
    id: id as DeckId,
    name,
    public: publication === "public",
    ...(publication !== "private" && publication !== "public" && { screening: publication }),
    ...(typeof icon === "string" && { icon }),
    ...(typeof color === "string" && { color }),
    ...(typeof description === "string" && { description }),
  };
}

function parseCardEntry(row: unknown): CardEntry | null {
  const id = field(row, "id");
  const deckId = field(row, "deck_id");
  const createdAt = parseTime(field(row, "created_at"));
  if (typeof id !== "string" || typeof deckId !== "string" || createdAt === null) return null;
  return { id: id as CardId, deckId: deckId as DeckId, createdAt };
}

function parseCard(row: unknown): Card | null {
  const entry = parseCardEntry(row);
  const content = parseCardContent({
    front: field(row, "front"),
    back: field(row, "back"),
    template: field(row, "template"),
    templateVersion: field(row, "template_version"),
  });
  if (!entry || !content) return null;
  return { ...entry, ...content };
}
