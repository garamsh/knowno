import type { ReactNode } from "react";

import type { Card, CardId } from "@/features/decks";

import type { Answer, AnswerWrite, SessionReview } from "./answer-write";
import { type CardStates, orderQueue, reinsert, type SelectedQueue } from "./queue";
import { type Random, seededRandom } from "./random";
import { type Pace, sessionMinutes } from "./study-time";
import { todayOf } from "./today-list";

/**
 * A card of the session: `decks`' card, its sides without the 칸 they read as, with each side as
 * the one line of text `decks` describes it as, a whole card's back as its revealed reading, and,
 * for a card holding a blank, its [WholeFaces]; and its front's length, as `decks`' `faceLength`
 * counts it, which sizes the current card (#635). The server adds these, since a client module
 * cannot import `decks`' entry point.
 */
export type StudyCard = Omit<Card, "cells"> & {
  text: { front: string; back: string };
  frontLength: number;
  whole?: WholeFaces;
  sides?: SideViews;
  sounds?: SoundViews;
};

/**
 * A card's sounds on each side, in order, each with its length and the signed address it plays
 * from, or null where the bucket signed none (ADR 0112).
 */
export type SoundViews = { front: Sound[]; back: Sound[] };

/** A sound a card holds: its media id, its length as `0:07`, and its signed address, if any. */
export type Sound = { media: string; length: string; url: string | null };

/**
 * A card with a senses block drawn as `decks` draws its sides, each label as its own span with
 * a narrow gap before the meaning (ADR 0075).
 */
export type SideViews = { front: ReactNode; back: ReactNode };

/**
 * A card holding a blank as `decks` draws it whole: what shows before the reveal as a screen
 * reader reads it, its blanks empty, and each 칸 in place before and after the reveal (ADR 0137).
 */
export type WholeFaces = { spokenFront: string; empty: ReactNode; filled: ReactNode };

/**
 * What a study page opens with, built on the server: the cards left in today's list, those the
 * queue rules selected and those answered "모른다" last today, whether they are a backlog, the
 * new cards past them, the stored state of each and of each card answered today, the start time,
 * which also seeds the session's random source, the study day, the user's pace, and what today
 * already holds. Times are milliseconds since the epoch.
 */
export type SessionPlan = {
  startedAt: number;
  /** The study day the session opened in, which today's list reads. */
  day: { start: number; end: number };
  queue: SelectedQueue<StudyCard>;
  /**
   * The cards answered "모른다" last today that the queue rules did not select, which the session
   * puts back as a re-show does.
   */
  relearn: StudyCard[];
  /** Whether a card of the day was done when the page opened, so the screen says it goes on. */
  resumed: boolean;
  /** The day's last answer stored before the page opened, to a card of the decks, if any. */
  earlier: EarlierAnswer | null;
  /** The new cards past today's, oldest first, which `studyOn` goes on with. */
  more: StudyCard[];
  /** The decks' cards answered today past the day's plan (`StudyDay.extra`), counted apart. */
  extra: CardId[];
  before: CardStates;
  pace: Pace;
  today: {
    /** The answers stored today for the decks' cards before the session opened. */
    answers: { cardId: CardId; answer: Answer; reviewedAt: number; durationMs: number }[];
    /** Whether an answer is stored today in any deck. */
    answeredAnyDeck: boolean;
    /** Study days in a row before today holding an answer. */
    streakBefore: number;
  };
};

/**
 * How many cards a session opened with, and the whole minutes they take at the user's pace, as
 * the today card counts them.
 */
export type SessionSize = { cards: number; minutes: number; resumed: boolean };

/**
 * The day's last answer from an earlier session: shown in the previous card's place until the
 * session's first answer, and not changed from there.
 */
export type EarlierAnswer = { card: StudyCard; answer: Answer };

/** An answer given in this session, shown in the stack above the current card. */
export type PreviousAnswer = {
  /** Where the answer stands among the session's answers, first at 0; what `toggle` takes. */
  position: number;
  card: StudyCard;
  answer: Answer;
  /** Whether the answer differs from the one first given. */
  changed: boolean;
};

/**
 * What the completion card shows of today's study day over the session's decks: the answers
 * stored before the session opened and the session's own written answers, as they stand.
 */
export type Completion = {
  /** Answers standing as each choice; a re-shown card counts each time. */
  knowCount: number;
  dontKnowCount: number;
  /** The time the cards were on screen before their answers. */
  timeSpentMs: number;
  /** Study days in a row with an answer, across every deck. */
  streak: number;
};

/**
 * What the screen shows: the current card; the completion card once no card is left today; or
 * nothing to study when no card is left to take and none was answered today.
 */
export type SessionView = {
  /** Oldest first. */
  previous: PreviousAnswer[];
  /**
   * The day's cards whose latest answer today, in this session or an earlier one, is "안다", of
   * the day's cards: those answered today within the day's plan before the session opened, and
   * the queue it opened with.
   */
  done: number;
  total: number;
  /**
   * The cards answered today past the day's plan, in this session or an earlier one, counted
   * apart so the day's count never grows with them.
   */
  extra: number;
  /** Before the session's first answer, the day's last answer from an earlier session. */
  earlier: EarlierAnswer | null;
} & (
  | {
      kind: "studying";
      current: StudyCard;
    }
  | {
      kind: "complete";
      completion: Completion;
      /** Whether new cards are left past today's, which `studyOn` goes on with. */
      more: boolean;
    }
  | { kind: "empty" }
);

/** An answer given in this session and the review that records it. */
type Answered = { card: StudyCard; answer: Answer; first: Answer; review: SessionReview };

/**
 * One study session, by the queue rules of study.md. It shows the cards left today, then the
 * completion card; from there, `studyOn` goes on with the new cards past today's, oldest first,
 * each answer recorded as any other. A session that opens with no card left today starts on
 * those at once. Every random choice, the queue's order, each re-show gap and each answer's
 * fuzz factor, comes from one source seeded with the start time. An answer or a toggle changes
 * the session at once and returns what to write, if anything.
 */
export class StudySession {
  private readonly random: Random;
  private readonly queue: StudyCard[];
  /** The day's cards, each once: answered today within the day's plan before the session, or queued. */
  private readonly dayCards: Set<CardId>;
  /** The cards past the day's plan, each once: answered past it before the session, or taken since. */
  private readonly extraCards: Set<CardId>;
  /** The new cards past today's, oldest first, not yet taken. */
  private more: StudyCard[];
  /** The session's size when it opened. */
  readonly size: SessionSize;
  private readonly answers: Answered[] = [];
  private shownAt: number;
  /** When the page was last hidden while the card on screen waited, or null while it is visible. */
  private pausedAt: number | null = null;
  /** The time hidden since the card on screen was shown, up to `pausedAt`. */
  private awayMs = 0;
  private snapshot: SessionView;

  constructor(
    private readonly plan: SessionPlan,
    private readonly clock: () => number,
    private readonly newId: () => string,
  ) {
    this.random = seededRandom(plan.startedAt);
    this.queue = orderQueue(plan.queue, this.random);
    // The cards still on "모른다" come back as a re-show does: after a gap drawn from the session's
    // random source, or at the end, in a backlog as out of one.
    for (const card of plan.relearn) reinsert(this.queue, card, this.random);
    this.extraCards = new Set(plan.extra);
    this.dayCards = new Set([
      ...plan.today.answers.flatMap(({ cardId }) => (this.extraCards.has(cardId) ? [] : [cardId])),
      ...this.queue.map((card) => card.id),
    ]);
    const fresh = this.queue.filter((card) => !plan.before[card.id]).length;
    this.size = {
      cards: this.queue.length,
      minutes: sessionMinutes(this.queue.length - fresh, fresh, plan.pace),
      resumed: plan.resumed,
    };
    this.more = [...plan.more];
    // Opening the page with no card left today is the choice to go on.
    if (this.queue.length === 0) this.takeMore();
    this.shownAt = plan.startedAt;
    this.snapshot = this.build();
  }

  /** What the screen shows now; the same object until the session changes. */
  view(): SessionView {
    return this.snapshot;
  }

  /** Answers the card on screen, shows the next, and returns the write that records it. */
  answer(answer: Answer): AnswerWrite | null {
    const card = this.queue[0];
    if (!card) return null;
    const now = this.clock();
    this.queue.shift();
    const review: SessionReview = {
      id: this.newId(),
      answer,
      reviewedAt: now,
      durationMs: this.onScreen(now),
      fuzzFactor: this.random.nextDouble(),
    };
    this.answers.push({ card, answer, first: answer, review });
    if (answer === "dontKnow") reinsert(this.queue, card, this.random);
    this.show(now);
    this.snapshot = this.build();
    return this.write(card.id, { kind: "answer", reviewId: review.id }, now);
  }

  /**
   * Stops the clock of the card on screen while the page is hidden, so an answer's duration
   * counts only the time the page was visible.
   */
  pause(): void {
    this.pausedAt ??= this.clock();
  }

  /** Starts the clock of the card on screen again as the page is shown. */
  resume(): void {
    if (this.pausedAt !== null) this.awayMs += this.clock() - this.pausedAt;
    this.pausedAt = null;
  }

  /** Starts the clock of the next card shown, at [now]. */
  private show(now: number): void {
    this.shownAt = now;
    this.awayMs = 0;
    if (this.pausedAt !== null) this.pausedAt = now;
  }

  /** The time the card on screen has been shown at [now] with the page visible. */
  private onScreen(now: number): number {
    const away = this.awayMs + (this.pausedAt === null ? 0 : now - this.pausedAt);
    return Math.max(0, now - this.shownAt - away);
  }

  /**
   * Goes on from the completion card with the new cards past today's, oldest first; with none
   * left, does nothing.
   */
  studyOn(): void {
    if (this.snapshot.kind !== "complete" || this.more.length === 0) return;
    this.takeMore();
    this.show(this.clock());
    this.snapshot = this.build();
  }

  /** Moves the new cards past today's into the queue. */
  private takeMore(): void {
    this.queue.push(...this.more);
    for (const card of this.more) this.extraCards.add(card.id);
    this.more = [];
  }

  /**
   * Toggles the answer at [position] between "안다" and "모른다" and returns the write that
   * reschedules its card. A toggle to "모른다" of a card's last answer puts the card back as an
   * answer would, unless it is waiting, which takes the completion card away again, and a toggle
   * to "안다" of a card's last answer removes its re-show while it waits behind the card on
   * screen.
   */
  toggle(position: number): AnswerWrite | null {
    const answered = this.answers[position];
    if (!answered) return null;
    const { card } = answered;
    const answer: Answer = answered.answer === "know" ? "dontKnow" : "know";
    answered.answer = answer;
    answered.review = { ...answered.review, answer };
    const isLast = !this.answers.slice(position + 1).some((later) => later.card.id === card.id);
    const now = this.clock();
    if (isLast) this.toggleQueued(card, answer, now);
    this.snapshot = this.build();
    return this.write(card.id, { kind: "toggle", reviewId: answered.review.id }, now);
  }

  /**
   * Changes the answer at [position] to [answer], as `toggle` does, and returns what to write;
   * an answer that already stands as [answer] is left as it is.
   */
  redecide(position: number, answer: Answer): AnswerWrite | null {
    const answered = this.answers[position];
    if (!answered || answered.answer === answer) return null;
    return this.toggle(position);
  }

  /** Toggles the session's last answer. */
  toggleLast(): AnswerWrite | null {
    return this.toggle(this.answers.length - 1);
  }

  /** Puts [card] back into the queue for a toggle to "모른다", or takes its re-show out for "안다". */
  private toggleQueued(card: StudyCard, answer: Answer, now: number): void {
    const waiting = this.queue.findIndex((queued) => queued.id === card.id);
    if (answer === "dontKnow" && waiting === -1) {
      if (this.queue.length === 0) this.show(now);
      reinsert(this.queue, card, this.random);
    } else if (answer === "know" && waiting > 0) {
      this.queue.splice(waiting, 1);
    }
  }

  /** The card's written answers in this session as they stand, replayed from its state at the start. */
  private write(cardId: CardId, change: AnswerWrite["change"], editedAt: number): AnswerWrite {
    const history = this.answers
      .filter((answered) => answered.card.id === cardId)
      .map((answered) => answered.review);
    const [first, ...rest] = history;
    if (!first) throw new Error(`no answer in this session for ${cardId}`);
    return {
      cardId,
      before: this.plan.before[cardId] ?? null,
      history: [first, ...rest],
      change,
      editedAt,
    };
  }

  private completion(): Completion {
    const written = this.answers;
    const answers = [
      ...this.plan.today.answers,
      ...written.map(({ answer, review }) => ({ answer, durationMs: review.durationMs })),
    ];
    const studiedToday = this.plan.today.answeredAnyDeck || written.length > 0;
    return {
      knowCount: answers.filter(({ answer }) => answer === "know").length,
      dontKnowCount: answers.filter(({ answer }) => answer === "dontKnow").length,
      timeSpentMs: answers.reduce((sum, { durationMs }) => sum + durationMs, 0),
      streak: this.plan.today.streakBefore + (studiedToday ? 1 : 0),
    };
  }

  private build(): SessionView {
    const previous = this.answers.map((answered, position) => ({
      position,
      card: answered.card,
      answer: answered.answer,
      changed: answered.answer !== answered.first,
    }));
    const places = todayOf(
      this.dayCards,
      this.plan.before,
      [
        ...this.plan.today.answers,
        // The session's own answers count in the day it opened in, whatever their time, so a
        // session open across 04:00 goes on counting.
        ...this.answers.map(({ card, review }) => ({
          cardId: card.id,
          answer: review.answer,
          reviewedAt: Math.min(review.reviewedAt, this.plan.day.end - 1000),
        })),
      ],
      this.plan.day,
    );
    const done = [...places.values()].filter((place) => place === "done").length;
    const earlier = this.answers.length === 0 ? this.plan.earlier : null;
    const answered = new Set([
      ...this.plan.today.answers.map(({ cardId }) => cardId),
      ...this.answers.map(({ card }) => card.id),
    ]);
    const extra = [...this.extraCards].filter((id) => answered.has(id)).length;
    const counts = { previous, done, total: this.dayCards.size, extra, earlier };
    const current = this.queue[0];
    if (current) return { ...counts, kind: "studying", current };
    if (this.plan.today.answers.length === 0 && this.answers.length === 0) {
      return { ...counts, kind: "empty" };
    }
    return {
      ...counts,
      kind: "complete",
      completion: this.completion(),
      more: this.more.length > 0,
    };
  }
}
