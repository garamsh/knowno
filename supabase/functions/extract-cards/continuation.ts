/**
 * Reading a page on after a reply cut at the output cap (ADR 0138): the request asking for the
 * entries after those read, the calls that go on until the page is done, and the cursor a client
 * sends back to go on in a later request.
 */

import type { Card, CardRule } from "./cards.ts";
import type { Attempt, Extraction } from "./model.ts";

/**
 * The fewest cards after which a whole reply is still read on, to confirm the page ends there: a
 * model may stop a dense page early by its own choice. Twice the 21 entries of the eval's largest
 * ordinary page, so an ordinary page makes no such call.
 */
export const CONFIRM_AFTER_CARDS = 40;

/** Whether a reply of [cards] cards, [cut] at the output cap or not, is read on after. */
export function readsOn(cut: boolean, cards: number): boolean {
  return cut || cards >= CONFIRM_AFTER_CARDS;
}

/** The most cards one photo may produce, over every call and request that reads it. */
export const MAX_PHOTO_CARDS = 500;

/** The most calls that continue one photo after its first read, over every request. */
export const MAX_CONTINUATIONS = 10;

/** The most characters of the last fronts read that a follow-up names and a cursor carries. */
export const MAX_NAMED_CHARS = 4_000;

/** The longest cursor a request may carry: the named fronts, four bytes each, base64 and JSON. */
export const MAX_CURSOR_LENGTH = 24 * 1024;

/** A cursor's token: a UUID that `private.extraction_cursors` holds until it is used or expires. */
export type CursorToken = string & { readonly __brand: "CursorToken" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function cursorToken(value: string): CursorToken | null {
  return UUID.test(value) ? value as CursorToken : null;
}

/** A random cursor token. */
export function newCursorToken(): CursorToken {
  const token = cursorToken(crypto.randomUUID());
  if (token === null) throw new Error("crypto.randomUUID answered no UUID");
  return token;
}

/** Where a later request goes on from: its token, and the last fronts read, in the page's order. */
export type Cursor = {
  readonly token: CursorToken;
  readonly fronts: readonly string[];
};

/** The last of [fronts] whose characters together fit `MAX_NAMED_CHARS`, in their order. */
export function lastFronts(fronts: readonly string[]): readonly string[] {
  const kept: string[] = [];
  let chars = 0;
  for (let i = fronts.length - 1; i >= 0; i--) {
    chars += [...fronts[i]].length;
    if (chars > MAX_NAMED_CHARS) break;
    kept.unshift(fronts[i]);
  }
  return kept;
}

/** [cursor] as the opaque text a client sends back: base64url of its JSON. */
export function encodeCursor(cursor: Cursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

/** The cursor [text] encodes, or null when it is not one `encodeCursor` could have written. */
export function decodeCursor(text: string): Cursor | null {
  if (text.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(text)) {
    return null;
  }
  let value: unknown;
  try {
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { token, fronts } = value as Record<string, unknown>;
  const parsed = typeof token === "string" ? cursorToken(token) : null;
  if (
    parsed === null || !Array.isArray(fronts) ||
    !fronts.every((front) => typeof front === "string")
  ) return null;
  return { token: parsed, fronts };
}

/**
 * The text sent after the photo asking for every entry the [read] cards read so far missed,
 * wherever it is on the page; [fronts] are theirs, or their last when they are too many to name.
 */
export function askForMissing(read: number, fronts: readonly string[]): string {
  const named = fronts.length === read
    ? "for the entries"
    : `the last ${fronts.length} for the entries`;
  return `${read} cards were already read from this material, ${named} ${
    fronts.map((front) => JSON.stringify(front)).join(", ")
  }. Answer with the cards of every entry of the material that is not in that list, wherever it is on the page, in the material's order, and no card for an entry in the list. When no entry is missing, answer an empty card list.`;
}

/** A card's front as a continuation compares it with the fronts already read. */
const key = (front: string) =>
  front.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** How far one request read a page on. */
export type ReadOn = {
  /** The cards read after those already read, none of them repeating a front named or read. */
  readonly cards: readonly Card[];
  readonly dropped: readonly CardRule[];
  readonly attempts: readonly Attempt[];
  /** The continuing calls made. */
  readonly calls: number;
  /** Whether the page was read to its end: a reply added no card, or few and was not cut. */
  readonly done: boolean;
  /** Whether every call failed, so the request read nothing on. */
  readonly failed: boolean;
};

/**
 * Asks [extract] for the entries after the [read] cards whose last fronts are [fronts], again after
 * each cut reply, while [mayStart] allows a call to start, the photo has fewer than
 * `MAX_PHOTO_CARDS` cards and at most [calls] calls are made. A failed call is asked again once.
 */
export async function readOn(
  extract: (followUp: string) => Promise<Extraction>,
  from: {
    readonly read: number;
    readonly fronts: readonly string[];
    readonly calls: number;
  },
  mayStart: () => boolean,
): Promise<ReadOn> {
  const cards: Card[] = [];
  const dropped: CardRule[] = [];
  const attempts: Attempt[] = [];
  const seen = new Set(from.fronts.map(key));
  let calls = 0;
  let failures = 0;
  let done = false;
  while (
    !done && failures < 2 && calls < from.calls &&
    from.read + cards.length < MAX_PHOTO_CARDS && mayStart()
  ) {
    const named = lastFronts([
      ...from.fronts,
      ...cards.map((one) => one.front),
    ]);
    const next = await extract(
      askForMissing(from.read + cards.length, named),
    );
    calls++;
    attempts.push(...next.attempts);
    if (next.kind !== "cards") {
      // A reply of no card past those read ends the page.
      done = next.kind === "no_cards";
      failures += done ? 0 : 1;
      continue;
    }
    const added = next.cards.filter((one) => !seen.has(key(one.front)))
      .slice(0, MAX_PHOTO_CARDS - from.read - cards.length);
    for (const one of added) seen.add(key(one.front));
    cards.push(...added);
    dropped.push(...next.dropped);
    done = added.length === 0 || !readsOn(next.cut, added.length);
  }
  return {
    cards,
    dropped,
    attempts,
    calls,
    done,
    failed: calls > 0 && cards.length === 0 && !done,
  };
}
