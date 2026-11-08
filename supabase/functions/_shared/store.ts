/**
 * The card tools' reads and writes, each through PostgREST as the caller: the user's token and the
 * anon key, so row-level security decides every row, never the service-role key (ADR 0126).
 */

import { SupabaseError, type UserId } from "./auth.ts";
import type { StoredSides } from "./frame.ts";

/** The caller's connection to the project's REST API. */
export type Store = {
  readonly url: string;
  readonly anonKey: string;
  readonly token: string;
  readonly userId: UserId;
  readonly fetch: typeof fetch;
};

/** The most rows the project's API returns for one request (`config.toml`, `max_rows`). */
const PAGE = 1000;

async function request(
  store: Store,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    apikey: store.anonKey,
    Authorization: `Bearer ${store.token}`,
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.prefer !== undefined) headers.Prefer = init.prefer;
  const response = await store.fetch(`${store.url}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }).catch((cause: unknown) => {
    throw new SupabaseError("the REST API could not be reached", { cause });
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new SupabaseError(`the REST API answered ${response.status}`);
  }
  return response;
}

async function rows(
  store: Store,
  path: string,
): Promise<Record<string, unknown>[]> {
  return rowsOf(await (await request(store, path)).json());
}

/** A response's rows, each an object. */
function rowsOf(body: unknown): Record<string, unknown>[] {
  if (!Array.isArray(body)) {
    throw new SupabaseError("the REST API answered without rows");
  }
  return body.map((row: unknown) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new SupabaseError(
        "the REST API answered a row that is not an object",
      );
    }
    return row as Record<string, unknown>;
  });
}

/** Every row [path] selects, a page at a time, in the order it names. */
async function allRows(
  store: Store,
  path: string,
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let offset = 0;; offset += PAGE) {
    const page = await rows(store, `${path}&limit=${PAGE}&offset=${offset}`);
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

function text(row: Record<string, unknown>, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new SupabaseError(`the REST API answered a row without ${column}`);
  }
  return value;
}

/** A deck of the caller's, as the tools return it. */
export type Deck = { readonly id: string; readonly name: string };

/** The caller's own filter: a public deck of another user is readable too, and never listed. */
function own(store: Store): string {
  return `user_id=eq.${store.userId}&deleted_at=is.null`;
}

/** The caller's live decks, oldest first, with each one's live card count. */
export async function listDecks(
  store: Store,
): Promise<(Deck & { card_count: number })[]> {
  const found = await allRows(
    store,
    `decks?select=id,name,cards(count)&${
      own(store)
    }&cards.deleted_at=is.null&order=created_at.asc,id.asc`,
  );
  return found.map((row) => {
    const counted = Array.isArray(row.cards) ? row.cards[0] : undefined;
    const count =
      typeof counted === "object" && counted !== null && "count" in counted
        ? counted.count
        : undefined;
    if (typeof count !== "number") {
      throw new SupabaseError("the REST API answered no card count");
    }
    return { id: text(row, "id"), name: text(row, "name"), card_count: count };
  });
}

/** The caller's live deck [deckId], or null when it is not one: absent, deleted or another's. */
export async function readDeck(
  store: Store,
  deckId: string,
): Promise<Deck | null> {
  const found = await rows(
    store,
    `decks?select=id,name&id=eq.${deckId}&${own(store)}`,
  );
  const row = found[0];
  return row === undefined
    ? null
    : { id: text(row, "id"), name: text(row, "name") };
}

/** The card-form skills served to the caller, as `public.card_form_skills` answers them. */
export async function cardFormRows(
  store: Store,
): Promise<Record<string, unknown>[]> {
  const response = await request(store, "rpc/card_form_skills", {
    method: "POST",
    body: {},
  });
  return rowsOf(await response.json());
}

/**
 * The caller's study record as `public.assistant_study_record` answers it, unparsed: [deckId]
 * limits it to one deck, [periodDays] is how far back its answers count.
 */
export async function studyRecordRows(
  store: Store,
  deckId: string | null,
  periodDays: number,
): Promise<unknown> {
  const response = await request(store, "rpc/assistant_study_record", {
    method: "POST",
    body: { deck_id: deckId, period_days: periodDays },
  });
  return await response.json();
}

/** A stored card's id and columns, as the read tools describe them. */
export type StoredCard = StoredSides & {
  readonly id: string;
  readonly deck_id: string;
};

const CARD_COLUMNS = "id,deck_id,front,back,template,template_version";

function storedCard(row: Record<string, unknown>): StoredCard {
  return {
    id: text(row, "id"),
    deck_id: text(row, "deck_id"),
    front: row.front,
    back: row.back,
    template: row.template,
    template_version: row.template_version,
  };
}

/** [limit] of a deck's live cards from [offset], oldest first, and how many it holds. */
export async function listCards(
  store: Store,
  deckId: string,
  offset: number,
  limit: number,
): Promise<{ cards: StoredCard[]; total: number }> {
  const response = await request(
    store,
    `cards?select=${CARD_COLUMNS}&deck_id=eq.${deckId}&${own(store)}` +
      `&order=created_at.asc,id.asc&limit=${limit}&offset=${offset}`,
    { prefer: "count=exact" },
  );
  const total = Number(response.headers.get("Content-Range")?.split("/")[1]);
  if (!Number.isInteger(total)) {
    throw new SupabaseError("the REST API answered no count");
  }
  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw new SupabaseError("the REST API answered without rows");
  }
  return { cards: body.map(storedCard), total };
}

/** Every live card of the caller's, with its deck. */
export async function allCards(store: Store): Promise<StoredCard[]> {
  return (await allRows(
    store,
    `cards?select=${CARD_COLUMNS}&${own(store)}&order=created_at.asc,id.asc`,
  )).map(storedCard);
}

/** Each live card's duplicate key in a deck, with the card's id. */
export async function deckKeys(
  store: Store,
  deckId: string,
): Promise<Map<string, string>> {
  const found = await allRows(
    store,
    `cards?select=id,card_key&deck_id=eq.${deckId}&${own(store)}&order=id.asc`,
  );
  return new Map(found.map((row) => [text(row, "card_key"), text(row, "id")]));
}

/** Inserts [rows] into [table] in one statement, so either all are stored or none is. */
export async function insert(
  store: Store,
  table: "decks" | "cards" | "media",
  rows: Record<string, unknown>[],
): Promise<void> {
  const response = await request(store, table, {
    method: "POST",
    body: rows,
    prefer: "return=minimal",
  });
  await response.body?.cancel();
}

/**
 * Sets [values] on the caller's live rows of [table] that [filter] selects, in one statement, and
 * answers the ids it changed. The server's trigger gives each changed row a new revision.
 */
export async function update(
  store: Store,
  table: "decks" | "cards",
  filter: string,
  values: Record<string, unknown>,
): Promise<string[]> {
  const changed = await request(
    store,
    `${table}?select=id&${filter}&${own(store)}`,
    { method: "PATCH", body: values, prefer: "return=representation" },
  );
  return rowsOf(await changed.json()).map((row) => text(row, "id"));
}

/** The caller's live cards of [ids], with their columns, in any order. */
export async function readCards(
  store: Store,
  ids: readonly string[],
): Promise<StoredCard[]> {
  return ids.length === 0 ? [] : (await rows(
    store,
    `cards?select=${CARD_COLUMNS}&id=in.(${ids.join(",")})&${own(store)}`,
  )).map(storedCard);
}

/** The live cards of the caller's deck [deckId], with their columns. */
export async function deckCards(
  store: Store,
  deckId: string,
): Promise<StoredCard[]> {
  return (await allRows(
    store,
    `cards?select=${CARD_COLUMNS}&deck_id=eq.${deckId}&${
      own(store)
    }&order=id.asc`,
  )).map(storedCard);
}

/** The media id of the caller's live deck [deckId]'s image, or null when it has none. */
export async function deckImage(
  store: Store,
  deckId: string,
): Promise<string | null> {
  const found = await rows(
    store,
    `decks?select=image_media_id&id=eq.${deckId}&${own(store)}`,
  );
  const image = found[0]?.image_media_id;
  return typeof image === "string" ? image : null;
}

/**
 * Those of [media] a live deck or card of the caller's still holds, as the app reads it: a deck by
 * its image, and a card whose blocks name the id anywhere, so a block this build cannot read holds.
 */
export async function heldMedia(
  store: Store,
  media: readonly string[],
): Promise<Set<string>> {
  if (media.length === 0) return new Set();
  const decks = await rows(
    store,
    `decks?select=image_media_id&image_media_id=in.(${media.join(",")})&${
      own(store)
    }`,
  );
  const cards = await allRows(
    store,
    `cards?select=front,back&${own(store)}&order=id.asc`,
  );
  const sides = cards.map((row) => JSON.stringify([row.front, row.back]));
  return new Set(
    media.filter((id) =>
      decks.some((row) => row.image_media_id === id) ||
      sides.some((side) => side.includes(id))
    ),
  );
}

/**
 * Deletes [media]'s files from the caller's folder through the Storage API, then their `media`
 * rows, as the app's release does.
 */
export async function releaseMedia(
  store: Store,
  media: readonly string[],
): Promise<void> {
  if (media.length === 0) return;
  const removed = await store.fetch(`${store.url}/storage/v1/object/media`, {
    method: "DELETE",
    headers: {
      apikey: store.anonKey,
      Authorization: `Bearer ${store.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prefixes: media.map((id) => `${store.userId}/${id}`),
    }),
  }).catch((cause: unknown) => {
    throw new SupabaseError("the Storage API could not be reached", { cause });
  });
  await removed.body?.cancel();
  if (!removed.ok) {
    throw new SupabaseError(`the Storage API answered ${removed.status}`);
  }
  const taken = await request(
    store,
    `media?id=in.(${media.join(",")})&user_id=eq.${store.userId}`,
    { method: "DELETE" },
  );
  await taken.body?.cancel();
}

/** Each live card's id and duplicate key in the caller's decks [deckIds]. */
export async function cardKeys(
  store: Store,
  deckIds: readonly string[],
): Promise<{ id: string; deck_id: string; card_key: string }[]> {
  return deckIds.length === 0 ? [] : (await allRows(
    store,
    `cards?select=id,deck_id,card_key&deck_id=in.(${deckIds.join(",")})&${
      own(store)
    }&order=id.asc`,
  )).map((row) => ({
    id: text(row, "id"),
    deck_id: text(row, "deck_id"),
    card_key: text(row, "card_key"),
  }));
}

/**
 * Stores a photo as the phone's upload does: its `media` row, which the bucket's policy requires,
 * then its file at `{owner}/{media id}`. A file that is refused takes its row back.
 */
export async function storePhoto(
  store: Store,
  media: string,
  photo: { bytes: Uint8Array<ArrayBuffer>; mimeType: string },
): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", photo.bytes);
  await insert(store, "media", [{
    id: media,
    user_id: store.userId,
    kind: "image",
    mime_type: photo.mimeType,
    byte_size: photo.bytes.length,
    sha256: [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  }]);
  const answer = await store.fetch(
    `${store.url}/storage/v1/object/media/${store.userId}/${media}`,
    {
      method: "POST",
      headers: {
        apikey: store.anonKey,
        Authorization: `Bearer ${store.token}`,
        "Content-Type": photo.mimeType,
      },
      body: photo.bytes,
    },
  ).catch(() => null);
  await answer?.body?.cancel();
  if (answer?.ok) return;
  const taken = await request(
    store,
    `media?id=eq.${media}&user_id=eq.${store.userId}`,
    { method: "DELETE" },
  );
  await taken.body?.cancel();
  throw new SupabaseError("the Storage API refused a photo");
}
