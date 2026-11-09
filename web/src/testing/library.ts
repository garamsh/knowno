import { testUser } from "./mocks/handlers";
import type { FakePostgrest } from "./mocks/postgrest";

/** A day, in milliseconds. */
export const day = 86_400_000;

/**
 * The time a test's clock is set to. It is in the past, so the test session's access token,
 * which expires an hour after the real time, is still valid at it.
 */
export const start = Date.UTC(2026, 0, 15, 9);

const iso = (time: number) => new Date(time).toISOString();

/**
 * The uuid a test's deck or card named [name] is stored under, as the server keys every synced
 * row: the name's bytes in hex, padded with zeros, so each name has its own and a test still
 * reads it by name. A name longer than 16 bytes has none.
 */
export function uuidOf(name: string): string {
  const hex = Buffer.from(name, "utf8").toString("hex");
  if (hex.length > 32) throw new Error(`no uuid holds the name ${name}`);
  const digits = hex.padEnd(32, "0");
  return [8, 12, 16, 20].reduceRight((id, at) => `${id.slice(0, at)}-${id.slice(at)}`, digits);
}

/** A text card side, as the phone stores it. */
export const side = (text: string) => [{ type: "text", payload: { text } }];

/** A deck row as the phone's sync pushes it, under [uuidOf] [id], private unless [visibility] says otherwise. */
export function deckRow(
  id: string,
  name: string,
  deleted = false,
  visibility: "private" | "public" = "private",
) {
  return {
    id: uuidOf(id),
    user_id: testUser.id,
    name,
    visibility,
    publication: visibility,
    created_at: iso(start - 30 * day),
    updated_at: iso(start - 30 * day),
    deleted_at: deleted ? iso(start - day) : null,
  };
}

/** A card row as the phone's sync pushes it, under [uuidOf] [id] in [uuidOf] [deckId], created [age] milliseconds before [start]. */
export function cardRow(id: string, deckId: string, front: string, age = day, deleted = false) {
  return {
    id: uuidOf(id),
    user_id: testUser.id,
    deck_id: uuidOf(deckId),
    front: side(front),
    back: side(`${front} back`),
    card_key: front.toLowerCase(),
    source: "manual",
    created_at: iso(start - age),
    updated_at: iso(start - age),
    deleted_at: deleted ? iso(start - day) : null,
  };
}

/** A stored card state of [uuidOf] [cardId], last reviewed at [lastReview] and due at [due]. */
export function stateRow(
  cardId: string,
  state: { stability: number; difficulty: number; lastReview: number; due: number },
) {
  return {
    user_id: testUser.id,
    card_id: uuidOf(cardId),
    stability: state.stability,
    difficulty: state.difficulty,
    last_review: iso(state.lastReview),
    due: iso(state.due),
    updated_at: iso(state.lastReview),
  };
}

/** A review of [uuidOf] [cardId] as the phone's sync pushes it, given at [reviewedAt] after [durationMs]. */
export function reviewRow(id: string, cardId: string, reviewedAt: number, durationMs: number) {
  return {
    id,
    user_id: testUser.id,
    card_id: uuidOf(cardId),
    rating: "good",
    reviewed_at: iso(reviewedAt),
    duration_ms: durationMs,
    fuzz_factor: null,
    updated_at: iso(reviewedAt),
  };
}

/** Seeds one deck, [deckId], holding a new card for each of [fronts], the first the oldest. */
export function seedDeck(postgrest: FakePostgrest, deckId: string, fronts: string[]) {
  postgrest.seed("decks", deckRow(deckId, deckId));
  postgrest.seed(
    "cards",
    ...fronts.map((front, index) =>
      cardRow(`${deckId}-${String(index)}`, deckId, front, (fronts.length - index) * 1000),
    ),
  );
}
