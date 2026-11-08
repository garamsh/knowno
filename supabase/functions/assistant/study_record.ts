/**
 * The study record tool (#761, `assistant.md` §Tools): each deck's cards by progress label, its cards due and its
 * answers in a period, and the cards the user answered "모른다" most often, read as the caller by
 * `public.assistant_study_record`, which holds the progress label, the due rule and the study day.
 */

import { SupabaseError } from "../_shared/auth.ts";
import { type Store, studyRecordRows } from "../_shared/store.ts";
import { cardOf } from "../_shared/tools.ts";
import { READ_PAGE } from "./photo_tools.ts";
import type { Ran } from "./tools.ts";

/** The period `read_study_record` reads when it is given none, in days. */
export const DEFAULT_PERIOD_DAYS = 30;

/** The zone the study day is counted in when the message named none. */
export const DEFAULT_TIME_ZONE = "Asia/Seoul";

/** The longest period it reads, in days. */
export const MAX_PERIOD_DAYS = 365;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Row = Record<string, unknown>;

const refuse = (message: string): Ran => ({
  content: message,
  isError: true,
  shown: null,
});

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowsAt(row: Row, key: string): Row[] {
  const found = row[key];
  if (!Array.isArray(found) || !found.every(isRow)) {
    throw new SupabaseError(
      "the REST API answered a study record without rows",
    );
  }
  return found;
}

function numberAt(row: Row, key: string): number {
  const found = row[key];
  if (typeof found !== "number") {
    throw new SupabaseError(`the REST API answered no ${key}`);
  }
  return found;
}

function textAt(row: Row, key: string): string {
  const found = row[key];
  if (typeof found !== "string") {
    throw new SupabaseError(`the REST API answered no ${key}`);
  }
  return found;
}

/** The record of the caller's decks and most missed cards, [periodDays] back, for [deckId] alone when given. */
export async function readStudyRecord(
  args: Record<string, unknown>,
  store: Store,
  timeZone: string | null,
): Promise<Ran> {
  const id = args.deck_id === undefined
    ? null
    : typeof args.deck_id === "string" && UUID.test(args.deck_id.toLowerCase())
    ? args.deck_id.toLowerCase()
    : undefined;
  if (id === undefined) {
    return refuse(
      "deck_id must be a deck's id, a uuid, as list_decks returns it.",
    );
  }
  const period = args.period_days ?? DEFAULT_PERIOD_DAYS;
  if (
    typeof period !== "number" || !Number.isSafeInteger(period) ||
    period < 1 || period > MAX_PERIOD_DAYS
  ) {
    return refuse(
      `period_days is a number of days from 1 to ${MAX_PERIOD_DAYS}, ${DEFAULT_PERIOD_DAYS} by default.`,
    );
  }
  const record = await studyRecordRows(
    store,
    id,
    period,
    timeZone ?? DEFAULT_TIME_ZONE,
  );
  if (!isRow(record)) {
    throw new SupabaseError("the REST API answered no study record");
  }
  const decks = rowsAt(record, "decks").map((deck) => {
    const answers = numberAt(deck, "answers");
    const known = numberAt(deck, "known");
    return {
      id: textAt(deck, "id"),
      name: textAt(deck, "name"),
      cards: {
        new: numberAt(deck, "new"),
        learning: numberAt(deck, "learning"),
        mastered: numberAt(deck, "mastered"),
      },
      due: numberAt(deck, "due"),
      answers,
      known,
      known_percent: answers === 0 ? null : Math.round(known / answers * 100),
    };
  });
  if (id !== null && decks.length === 0) {
    return refuse(
      "No deck of the signed-in user has this id, or it was deleted. Call list_decks for the ids of the user's decks.",
    );
  }
  const missed = rowsAt(record, "missed").map((row) => ({
    ...cardOf({
      id: textAt(row, "id"),
      front: row.front,
      back: row.back,
      template: row.template,
      template_version: row.template_version,
    }),
    deck_id: textAt(row, "deck_id"),
    missed: numberAt(row, "misses"),
    answers: numberAt(row, "answers"),
  }));
  const answer = (shown: typeof missed) => ({
    period_days: period,
    decks,
    most_missed: shown,
    most_missed_cut: missed.length - shown.length,
    note:
      "Labels: new has no answer yet, learning was answered and comes back within 21 days, mastered comes back in 21 days or more. due counts the answered cards due before today's study day ends, 04:00 in the user's time zone. known is the answers of Know, and missed the answers of Don't know, within the period. most_missed holds each card's blocks as list_cards returns them; most_missed_cut counts the cards left out to keep the answer short.",
  });
  let shown = missed;
  while (shown.length > 0 && JSON.stringify(answer(shown)).length > READ_PAGE) {
    shown = shown.slice(0, shown.length - 1);
  }
  return { content: answer(shown), isError: false, shown: null };
}
