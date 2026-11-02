import type { CardId } from "@/features/decks";

import { type CardState, type CardStates, type StudyDay, studyDayEnd } from "./queue";

// What the 오늘 page and the deck pages show of a selection beyond its queue, by the definitions
// of study.md, as app/lib/study/src/overview.dart computes them on the phone.

/** The interval, in days, from which a reviewed card counts as mastered (익힘). */
export const masteredIntervalDays = 21;

/** How many study days the next review looks ahead over, today included. */
export const chartDays = 7;

const day = 86_400_000;

/** How far a card has come: 익힘, 학습 중 or 새 카드. */
export type CardProgress = "mastered" | "learning" | "fresh";

/**
 * The progress of a card whose stored state is [state], undefined when it was never reviewed.
 * The current interval is the time from its last review to its due time.
 */
export function progressOf(state: CardState | undefined): CardProgress {
  if (!state) return "fresh";
  return state.due - state.lastReview >= masteredIntervalDays * day ? "mastered" : "learning";
}

/** How many of a selection's cards are mastered, learning and new. */
export type DeckProgress = { mastered: number; learning: number; fresh: number };

/** The progress of every one of [cards], from the stored [states] of those reviewed. */
export function deckProgress(cards: Iterable<{ id: CardId }>, states: CardStates): DeckProgress {
  const progress = { mastered: 0, learning: 0, fresh: 0 };
  for (const card of cards) progress[progressOf(states[card.id])] += 1;
  return progress;
}

/**
 * The first study day after [today], within `chartDays` of it, on which one of the stored
 * [states] falls due in [timeZone]: how many days after [today] it is, and how many cards fall due
 * in it; null when none does.
 */
export function nextReviewOf(
  states: Iterable<CardState>,
  today: StudyDay,
  timeZone: string,
): { after: number; cards: number } | null {
  const ends = [today.end];
  while (ends.length < chartDays) {
    ends.push(studyDayEnd(ends[ends.length - 1] ?? today.end, timeZone));
  }
  const counts = Array.from({ length: chartDays }, () => 0);
  for (const state of states) {
    // A card due before the day ends, today's or overdue, is on no later day.
    const index = ends.findIndex((end) => state.due < end);
    if (index > 0) counts[index] = (counts[index] ?? 0) + 1;
  }
  const after = counts.findIndex((count, index) => index > 0 && count > 0);
  return after > 0 ? { after, cards: counts[after] ?? 0 } : null;
}
