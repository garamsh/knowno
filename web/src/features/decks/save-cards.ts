"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/supabase/server";
import { readUserId } from "@/supabase/session";
import { selectAll } from "@/supabase/select-all";
import { requestTimeoutMs } from "@/supabase/failure";
import { field, parseTime } from "@/supabase/row";
import {
  frameKey,
  frameRefusal,
  mediaOf,
  mergeBack,
  parseCellsDraft,
  type CardDraft,
  type StoredCard,
} from "./authoring";
import { parseCardContent, parseCells, plainText, sidesOf } from "./card-content";
import { parseCardId, parseDeckId } from "./library";

/**
 * A duplicate warning stores nothing and names the stored or earlier card it repeats and the
 * index of the input card that repeats it; a failed save leaves the caller's draft intact.
 */
export type SaveCardsResult =
  { saved: true } | { saved: false; message: string; duplicate?: string; at?: number };
const malformed = { saved: false as const, message: "카드 내용을 확인해 주세요" };
const failed = { saved: false as const, message: "카드를 저장하지 못했어요. 다시 시도해 주세요." };
const signedOut = { saved: false as const, message: "다시 로그인해 주세요" };
const repeated = "이 노트에 이미 있는 카드예요";
const noDeck = {
  saved: false as const,
  message: "노트를 찾을 수 없어요. 추가할 노트를 다시 골라 주세요.",
};
const gone = { saved: false as const, message: "카드를 찾을 수 없어요. 노트를 다시 열어 주세요." };
const later = {
  saved: false as const,
  message: "다른 곳에서 더 나중에 고친 카드예요. 노트를 다시 열어 주세요.",
};
/** The phone's words for a card this build cannot edit. */
const cardNeedsUpdate =
  "새 버전의 앱에서 만든 카드라 이 버전에서는 편집할 수 없어요. 앱을 업데이트해 주세요.";

/** What a card does when a card in its deck already has its key, as the phone's `DuplicateChoice`. */
type OnDuplicate = "refuse" | "add" | "merge";
type Client = Awaited<ReturnType<typeof createClient>>;

/** A new card of 칸, `free` v2 (ADR 0137). It holds no media: the web uploads none. */
function parseNewCard(value: unknown): CardDraft | null {
  const card = parseCellsDraft(value);
  return card && mediaOf(parseCells(card.front) ?? []).length === 0 ? card : null;
}

/** Inserts explicit reviewed cards under the current owner, using stable ids for safe retries. */
export async function saveCards(
  deckId: string,
  input: unknown,
  source: "manual" | "import",
  allowDuplicate = false,
): Promise<SaveCardsResult> {
  if (typeof allowDuplicate !== "boolean") return malformed;
  return writeCards(deckId, input, source, allowDuplicate ? "add" : "refuse");
}

/**
 * Saves a photo's reviewed cards as the phone's `addCards` does: a card whose key the deck, or an
 * earlier card of [input], holds merges its back into that card. A retry appends nothing a back holds.
 */
export async function savePhotoCards(deckId: string, input: unknown): Promise<SaveCardsResult> {
  return writeCards(deckId, input, "import", "merge");
}

/** Inserts direct entry's card of 칸, its id stable across retries, in `free` v2. */
export async function addCard(
  deckId: string,
  input: unknown,
  allowDuplicate = false,
): Promise<SaveCardsResult> {
  if (typeof allowDuplicate !== "boolean") return malformed;
  const refused = frameRefusal(input);
  if (refused) return { saved: false, message: refused };
  return writeCards(deckId, [input], "manual", allowDuplicate ? "add" : "refuse");
}

/**
 * Writes a stored card's 칸 over it in `free` v2 (ADR 0143), its id, source, creation and reviews
 * kept, its key taken from the new 칸 as the phone's `editCard`. The later `updated_at` wins, as
 * `sync.md` has it: an edit made elsewhere with a later time stays, and this one is refused. A
 * card this build cannot edit, one deleted, and a photo or sound it does not hold are refused.
 */
export async function editCard(
  deckId: string,
  cardId: string,
  input: unknown,
  allowDuplicate = false,
): Promise<SaveCardsResult> {
  if (!parseDeckId(deckId) || !parseCardId(cardId) || typeof allowDuplicate !== "boolean")
    return malformed;
  const refused = frameRefusal(input);
  if (refused) return { saved: false, message: refused };
  if (!boundedJson(input)) return malformed;
  const card = parseCellsDraft(input);
  const cells = card && parseCells(card.front);
  if (!card || !cells || card.id !== cardId) return malformed;
  const client = await createClient();
  const session = await readUserId(client);
  if ("failure" in session) return signedOut;
  const { userId } = session;
  if (!(await holdsDeck(client, userId, deckId))) return noDeck;
  const owned = () =>
    client
      .from("cards")
      .select("id,front,back,template,template_version,updated_at")
      .eq("id", cardId)
      .eq("user_id", userId)
      .eq("deck_id", deckId)
      .is("deleted_at", null)
      .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  const read = await owned();
  if (read.error || !Array.isArray(read.data)) return failed;
  const [row] = read.data as unknown[];
  if (!row) return gone;
  const stored = parseCardContent({
    front: field(row, "front"),
    back: field(row, "back"),
    template: field(row, "template"),
    templateVersion: field(row, "template_version"),
  });
  if (!stored) return failed;
  if (stored.readOnly) return { saved: false, message: cardNeedsUpdate };
  const held = new Set(mediaOf(stored.cells));
  if (mediaOf(cells).some((media) => !held.has(media))) return malformed;
  const key = frameKey(cells);
  if (!allowDuplicate) {
    const same = await client
      .from("cards")
      .select("id")
      .eq("deck_id", deckId)
      .eq("user_id", userId)
      .eq("card_key", key)
      .is("deleted_at", null)
      .abortSignal(AbortSignal.timeout(requestTimeoutMs));
    if (same.error || !Array.isArray(same.data)) return failed;
    const duplicate = same.data
      .map((other: unknown) => field(other, "id"))
      .find((id) => id !== cardId);
    if (typeof duplicate === "string") return { saved: false, message: repeated, duplicate };
  }
  const now = new Date().toISOString();
  const write = await client
    .from("cards")
    .update({
      front: card.front,
      back: [],
      card_key: key,
      template: "free",
      template_version: 2,
      updated_at: now,
    })
    .eq("id", cardId)
    .eq("user_id", userId)
    .eq("deck_id", deckId)
    .is("deleted_at", null)
    .lt("updated_at", now)
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (write.error) return failed;
  const persisted = await owned();
  if (persisted.error || !Array.isArray(persisted.data)) return failed;
  const [saved] = persisted.data as unknown[];
  if (!saved) return gone;
  const time = parseTime(field(saved, "updated_at"));
  if (time !== Date.parse(now)) return time !== null && time > Date.parse(now) ? later : failed;
  if (JSON.stringify(parseCells(field(saved, "front"))) !== JSON.stringify(cells)) return failed;
  revalidatePath("/", "layout");
  return { saved: true };
}

async function writeCards(
  deckId: string,
  input: unknown,
  source: "manual" | "import",
  onDuplicate: OnDuplicate,
): Promise<SaveCardsResult> {
  if (
    !parseDeckId(deckId) ||
    !Array.isArray(input) ||
    input.length < 1 ||
    input.length > 100 ||
    !["manual", "import"].includes(source) ||
    !boundedJson(input)
  )
    return malformed;
  const cards = input.map(parseNewCard);
  if (cards.some((card) => !card || !parseCardId(card.id))) return malformed;
  const client = await createClient();
  const session = await readUserId(client);
  if ("failure" in session) return signedOut;
  const { userId } = session;
  if (!(await holdsDeck(client, userId, deckId))) return noDeck;
  const existing = await selectAll((from, to, counted) =>
    client
      .from("cards")
      .select("id,card_key", counted ? { count: "exact" } : {})
      .eq("deck_id", deckId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("id")
      .range(from, to)
      .abortSignal(AbortSignal.timeout(requestTimeoutMs)),
  );
  if ("failure" in existing) return failed;
  const now = new Date().toISOString();
  const rows = [];
  const merges: { into: string; back: string }[] = [];
  const storedIds = new Set(existing.rows.map((row) => field(row, "id")));
  const keys = new Map(
    existing.rows.flatMap((row) => {
      const key = field(row, "card_key");
      const id = field(row, "id");
      return typeof key === "string" && typeof id === "string" ? [[key, id] as const] : [];
    }),
  );
  const seenIds = new Set<string>();
  for (const [at, card] of cards.entries()) {
    const cells = card && parseCells(card.front);
    if (!card || !cells || seenIds.has(card.id)) return malformed;
    seenIds.add(card.id);
    const key = frameKey(cells);
    const duplicate = keys.get(key);
    if (onDuplicate === "merge" && duplicate) {
      merges.push({ into: duplicate, back: plainText(sidesOf(cells).back) });
      continue;
    }
    if (onDuplicate === "refuse" && duplicate && duplicate !== card.id)
      return { saved: false, message: repeated, duplicate, at };
    keys.set(key, card.id);
    rows.push({
      ...card,
      deck_id: deckId,
      user_id: userId,
      card_key: key,
      source,
      template: "free",
      template_version: 2,
      created_at: now,
      updated_at: now,
    });
  }
  const read = await readCards(client, userId, deckId, [
    ...new Set(merges.map(({ into }) => into).filter((into) => storedIds.has(into))),
  ]);
  if (!read) return failed;
  const targets = new Map(read);
  for (const row of rows)
    targets.set(row.id, {
      front: row.front,
      back: row.back,
      template: row.template,
      templateVersion: row.template_version,
    });
  for (const { into, back } of merges) {
    const target = targets.get(into);
    const merged = target && mergeBack(target, back);
    if (!merged) return failed;
    targets.set(into, merged);
  }
  const inserted = rows.map((row) => ({ ...row, front: targets.get(row.id)?.front ?? row.front }));
  const updated = [...read].flatMap(([id, card]) => {
    const merged = targets.get(id);
    return merged && merged !== card ? [{ id, ...merged }] : [];
  });
  const written = [...inserted, ...updated];
  if (written.length === 0) return { saved: true };
  if (inserted.length > 0) {
    const write = await client
      .from("cards")
      .upsert(inserted, { onConflict: "id", ignoreDuplicates: true })
      .abortSignal(AbortSignal.timeout(requestTimeoutMs));
    if (write.error) return failed;
  }
  for (const { id, front, back, template, templateVersion } of updated) {
    const write = await client
      .from("cards")
      .update({ front, back, template, template_version: templateVersion, updated_at: now })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("deck_id", deckId)
      .is("deleted_at", null)
      .abortSignal(AbortSignal.timeout(requestTimeoutMs));
    if (write.error) return failed;
  }
  const persisted = await client
    .from("cards")
    .select("id,deck_id,front,back")
    .eq("user_id", userId)
    .eq("deck_id", deckId)
    .is("deleted_at", null)
    .in(
      "id",
      written.map((row) => row.id),
    )
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (
    persisted.error ||
    !Array.isArray(persisted.data) ||
    !written.every((row) =>
      persisted.data.some(
        (saved: unknown) =>
          field(saved, "id") === row.id &&
          JSON.stringify(parseCells(field(saved, "front"))) ===
            JSON.stringify(parseCells(row.front)) &&
          JSON.stringify(parseCells(field(saved, "back"))) === JSON.stringify(parseCells(row.back)),
      ),
    )
  )
    return failed;
  revalidatePath("/", "layout");
  return { saved: true };
}

/** Whether the user owns the live deck [deckId]. */
async function holdsDeck(client: Client, userId: string, deckId: string): Promise<boolean> {
  const deck = await client
    .from("decks")
    .select("id")
    .eq("id", deckId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  return !deck.error && Array.isArray(deck.data) && deck.data.length === 1;
}

/** The live cards [ids] of the deck, as stored, by id; null when the read fails. */
async function readCards(
  client: Client,
  userId: string,
  deckId: string,
  ids: string[],
): Promise<Map<string, StoredCard> | null> {
  if (ids.length === 0) return new Map();
  const read = await client
    .from("cards")
    .select("id,front,back,template,template_version")
    .eq("user_id", userId)
    .eq("deck_id", deckId)
    .is("deleted_at", null)
    .in("id", ids)
    .abortSignal(AbortSignal.timeout(requestTimeoutMs));
  if (read.error || !Array.isArray(read.data)) return null;
  return new Map(
    read.data.map((row: unknown) => [
      String(field(row, "id")),
      {
        front: field(row, "front"),
        back: field(row, "back"),
        template: field(row, "template"),
        templateVersion: field(row, "template_version"),
      },
    ]),
  );
}

function boundedJson(value: unknown): boolean {
  try {
    return JSON.stringify(value).length <= 1_000_000;
  } catch {
    return false;
  }
}
