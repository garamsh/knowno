import "server-only";

import { field, parseTime } from "@/supabase/row";

import { call } from "./action-call";
import type { AdminRead } from "./read-admin";

/** Why a note is held: reports against it, an admin's earlier hold, or the AI layer's. */
export type HoldKind = "reports" | "admin" | "ai";

/** A held note in the queue: what an admin decides on, and the content hash that decision names. */
export type ScreeningHold = {
  id: string;
  name: string;
  owner: { id: string; email: string };
  /** Why it is held; null for a hold this version does not name. */
  hold: HoldKind | null;
  contentHash: string;
  reports: number;
  updatedAt: number;
};

/** What a finding found, as the server names it. */
export type FindingCategory =
  "resident_number" | "account" | "phone" | "link" | "kakao_id" | "contact" | "repeat" | "term";

const categories: readonly FindingCategory[] = [
  "resident_number",
  "account",
  "phone",
  "link",
  "kakao_id",
  "contact",
  "repeat",
  "term",
];

/** Where a finding is, as the owner's note names it. */
export type FindingPlace = "name" | "description" | "front" | "back";

/** One thing a screening found: its category, where, and the passage with the flagged span marked. */
export type ScreeningFinding = {
  category: FindingCategory;
  place: FindingPlace;
  /** The text around the flagged span, split at it; null where the span cannot be placed in the text. */
  passage: { before: string; flagged: string; after: string } | null;
};

/** A held note's findings, read for the content hash an admin sees. */
export type ScreeningDetail = {
  /** Whether the note changed since the queue was read, so no finding fits it. */
  changed: boolean;
  /** Whether a layer that must screen it has not yet. */
  unscreened: boolean;
  findings: ScreeningFinding[];
};

/** A banned word. */
export type ScreeningTerm = { id: number; term: string; createdAt: number };

const holds: readonly HoldKind[] = ["reports", "admin", "ai"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** The notes held for an admin's decision, the oldest first. */
export async function readScreeningQueue(): Promise<AdminRead<ScreeningHold[]>> {
  const read = await call("admin_screening_queue");
  if ("failure" in read) return read;
  if (!Array.isArray(read.data)) return { failure: "unreadable" };
  const list: ScreeningHold[] = [];
  for (const row of read.data as unknown[]) {
    const id = text(field(row, "deck_id"));
    const name = text(field(row, "name"));
    const ownerId = text(field(row, "owner_id"));
    const email = field(row, "owner_email");
    const kind = field(row, "hold");
    const hash = text(field(row, "content_hash"));
    const reports = field(row, "reports");
    const updatedAt = parseTime(field(row, "updated_at"));
    const hold = holds.find((known) => known === kind) ?? null;
    if (id === null || name === null || ownerId === null || typeof email !== "string") {
      return { failure: "unreadable" };
    }
    if (hash === null || typeof reports !== "number" || updatedAt === null) {
      return { failure: "unreadable" };
    }
    if (kind !== null && hold === null) return { failure: "unreadable" };
    list.push({
      id,
      name,
      owner: { id: ownerId, email },
      hold,
      contentHash: hash,
      reports,
      updatedAt,
    });
  }
  return { data: list };
}

/** The strings of [value] by their dotted path, as the server's rules write a finding's `field`. */
function leaves(value: unknown, path = "", into = new Map<string, string>()): Map<string, string> {
  if (typeof value === "string") {
    if (value !== "") into.set(path, value);
  } else if (Array.isArray(value)) {
    (value as unknown[]).forEach((item, index) =>
      leaves(item, path === "" ? String(index) : `${path}.${String(index)}`, into),
    );
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      leaves(item, path === "" ? key : `${path}.${key}`, into);
    }
  }
  return into;
}

/** The one string of [strings], or null where there are none or several. */
function onlyString(strings: Map<string, string>): string | null {
  return strings.size === 1 ? (strings.values().next().value ?? null) : null;
}

/** [source] split at [start, end), or null when that span is not inside it. */
function split(source: string, start: unknown, end: unknown): ScreeningFinding["passage"] {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  const from = start as number;
  const to = end as number;
  if (from < 0 || to <= from || to > source.length) return null;
  return {
    before: source.slice(0, from),
    flagged: source.slice(from, to),
    after: source.slice(to),
  };
}

/**
 * The findings the screening recorded for held note [id] at [contentHash], each with the passage
 * it flagged. A finding's offsets are in the string its `field` names; one without a `field` is
 * placed only where its block holds exactly one string.
 */
export async function readScreeningDetail(
  id: string,
  contentHash: string,
): Promise<AdminRead<ScreeningDetail>> {
  const read = await call("admin_screening_findings", { deck_id: id, content_hash: contentHash });
  if ("failure" in read) return read;
  const changed = field(read.data, "changed");
  const unscreened = field(read.data, "unscreened");
  const found = field(read.data, "findings");
  if (typeof changed !== "boolean" || typeof unscreened !== "boolean" || !Array.isArray(found)) {
    return { failure: "unreadable" };
  }
  if (changed || found.length === 0) {
    return { data: { changed, unscreened, findings: [] } };
  }
  const [deck, cards] = await Promise.all([
    call("admin_user_deck", { deck_id: id }),
    call("admin_user_deck_cards", { deck_id: id }),
  ]);
  if ("failure" in deck) return deck;
  if ("failure" in cards) return cards;
  const deckRow: unknown = Array.isArray(deck.data) ? (deck.data as unknown[])[0] : undefined;
  const sides = new Map<string, Record<string, unknown>>();
  if (Array.isArray(cards.data)) {
    for (const row of cards.data as unknown[]) {
      const cardId = text(field(row, "card_id"));
      if (cardId !== null && isRecord(row)) sides.set(cardId, row);
    }
  }
  const findings: ScreeningFinding[] = [];
  for (const item of found as unknown[]) {
    const category = categories.find((known) => known === field(item, "category"));
    const where = field(item, "where");
    const place: FindingPlace | undefined = (
      ["name", "description", "front", "back"] as const
    ).find((known) => known === where);
    if (!category || !place) return { failure: "unreadable" };
    const start = field(item, "start");
    const end = field(item, "end");
    let source: string | null = null;
    if (place === "name" || place === "description") {
      const value = field(deckRow, place);
      source = typeof value === "string" ? value : null;
    } else {
      const row = sides.get(text(field(item, "card_id")) ?? "");
      const blocks = row?.[place];
      const block: unknown = Array.isArray(blocks)
        ? (blocks as unknown[])[Number(field(item, "block"))]
        : undefined;
      const strings = leaves(field(block, "payload"));
      const path = field(item, "field");
      source = typeof path === "string" ? (strings.get(path) ?? null) : onlyString(strings);
    }
    findings.push({
      category,
      place,
      passage: source === null ? null : split(source, start, end),
    });
  }
  return { data: { changed, unscreened, findings } };
}

/** The banned words, in the order they were added. */
export async function readScreeningTerms(): Promise<AdminRead<ScreeningTerm[]>> {
  const read = await call("admin_screening_terms");
  if ("failure" in read) return read;
  if (!Array.isArray(read.data)) return { failure: "unreadable" };
  const list: ScreeningTerm[] = [];
  for (const row of read.data as unknown[]) {
    const id = field(row, "id");
    const term = text(field(row, "term"));
    const createdAt = parseTime(field(row, "created_at"));
    if (typeof id !== "number" || !Number.isInteger(id) || term === null || createdAt === null) {
      return { failure: "unreadable" };
    }
    list.push({ id, term, createdAt });
  }
  return { data: list };
}

/** A held note with what the screening found in it. */
export type ReviewedHold = ScreeningHold & { detail: ScreeningDetail };

/** The held notes, each with its findings, the oldest first. */
export async function readScreeningReview(): Promise<AdminRead<ReviewedHold[]>> {
  const queue = await readScreeningQueue();
  if ("failure" in queue) return queue;
  const details = await Promise.all(
    queue.data.map((hold) => readScreeningDetail(hold.id, hold.contentHash)),
  );
  const reviewed: ReviewedHold[] = [];
  for (const [index, hold] of queue.data.entries()) {
    const detail = details[index];
    if (detail === undefined || "failure" in detail) {
      return detail ?? { failure: "unreadable" };
    }
    reviewed.push({ ...hold, detail: detail.data });
  }
  return { data: reviewed };
}
