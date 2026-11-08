import type { CardId } from "@/features/decks";

import type { Answer } from "./answer-write";
import { type Today, todaysList } from "@/design/engine-wasm/knowno_engine_wasm.js";
import {
  type CardStates,
  type SelectedQueue,
  selectQueue,
  type StudyDay,
  type TodayCount,
} from "./queue";

export type { Today };

/** An answer as today's list reads it. Times are milliseconds since the epoch. */
export type DayAnswer = { cardId: CardId; answer: Answer; reviewedAt: number };

/**
 * Where each of [cards] stands in [day]'s list, through the engine's `today` (engine.md): from
 * the due time of its stored state in [states], none for a card never reviewed, and its
 * [answers] of the day, in any order. A card is "left" when its latest answer in the day is
 * "모른다", or when it has none and falls due before the day ends; "done" when its latest answer
 * in the day is "안다"; otherwise "absent". The engine counts whole seconds, so times are
 * truncated. The engine module must be loaded: `loadEngine` in the browser, `loadServerEngine`
 * on the server.
 */
export function todayOf(
  cards: Iterable<CardId>,
  states: CardStates,
  answers: readonly DayAnswer[],
  day: { start: number; end: number },
): Map<CardId, Today> {
  const ids = [...cards];
  const reviews = new Map<CardId, { answer: Answer; at: bigint }[]>();
  for (const answer of answers) {
    const list = reviews.get(answer.cardId) ?? [];
    list.push({ answer: answer.answer, at: toSeconds(answer.reviewedAt) });
    reviews.set(answer.cardId, list);
  }
  const places = todaysList(
    ids.map((id) => {
      const state = states[id];
      return { due: state ? toSeconds(state.due) : null, reviews: reviews.get(id) ?? [] };
    }),
    toSeconds(day.start),
    toSeconds(day.end),
  );
  if (places.length !== ids.length) {
    throw new Error(
      `today's list placed ${String(places.length)} cards of the ${String(ids.length)} given`,
    );
  }
  return new Map(ids.map((id, index) => [id, places[index] as Today]));
}

/**
 * A study day over a selection of decks, as today's list places its cards: the queue the rules
 * select, the cards still on "모른다" that the rules did not select, and the cards done; and apart
 * from them, the cards studied past the day's plan. The study session, the 오늘 page's count and
 * goal, and the deck pages all count from it, so they agree with each other and with the phone's.
 */
export type DayPlan<C> = {
  selected: SelectedQueue<C>;
  /** The cards answered "모른다" last today, which their state no longer makes due. */
  relearn: C[];
  /** The cards of the day's plan answered "안다" last today. */
  done: Set<CardId>;
  /**
   * The cards studied past the day's plan (`StudyDay.extra`), whatever their latest answer:
   * neither done nor left, so they never reopen the day.
   */
  extra: Set<CardId>;
};

/** The [DayPlan] of [day] over [cards], from their stored [states] and today's [answers] to them. */
export function dayPlanOf<C extends { id: CardId; createdAt: number }>(
  cards: readonly C[],
  states: CardStates,
  day: StudyDay,
  answers: readonly DayAnswer[],
): DayPlan<C> {
  const places = todayOf(
    cards.map((card) => card.id),
    states,
    answers,
    day,
  );
  // A card studied past the plan stays out of it, though a "모른다" makes it due again within the
  // day.
  const planned = cards.filter((card) => !day.extra.has(card.id));
  const selected = selectQueue(planned, states, day);
  const chosen = new Set(selected.cards.map((card) => card.id));
  return {
    selected,
    relearn: planned.filter((card) => places.get(card.id) === "left" && !chosen.has(card.id)),
    done: new Set(
      [...places].flatMap(([id, place]) => (place === "done" && !day.extra.has(id) ? [id] : [])),
    ),
    extra: new Set(cards.flatMap((card) => (day.extra.has(card.id) ? [card.id] : []))),
  };
}

/** The cards [plan] leaves today: its selection and the cards still on "모른다". */
export function leftOf(plan: DayPlan<unknown>): number {
  return plan.selected.cards.length + plan.relearn.length;
}

/**
 * How many cards [plan] leaves today, as reviews and new cards: the cards still on "모른다" are
 * reviews, as every card with a stored state in [states] is.
 */
export function countDay<C extends { id: CardId }>(
  plan: DayPlan<C>,
  states: CardStates,
): TodayCount {
  const fresh = plan.selected.cards.filter((card) => !states[card.id]).length;
  return { review: leftOf(plan) - fresh, fresh, backlog: plan.selected.backlog };
}

function toSeconds(milliseconds: number): bigint {
  return BigInt(Math.trunc(milliseconds / 1000));
}
