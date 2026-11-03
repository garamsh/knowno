import type { CardId } from "@/features/decks";

import type { CardState } from "./queue";

/** The app's two answers: "안다" and "모른다". */
export type Answer = "know" | "dontKnow";

/** An answer given in this session, as stored. Times are milliseconds since the epoch. */
export type SessionReview = {
  id: string;
  answer: Answer;
  reviewedAt: number;
  /** How long the card was on screen before the answer. */
  durationMs: number;
  /** Drawn once when the answer was given, and kept when it is toggled. */
  fuzzFactor: number;
};

/**
 * What one answer or toggle changes: the card's stored state when the session opened, its
 * answers in this session as they stand, oldest first, and which of them changed. The engine
 * reviews the history from that state, as the phone does, and the changed review and the
 * card's new state are written, each edited at [editedAt].
 */
export type AnswerWrite = {
  cardId: CardId;
  before: CardState | null;
  history: [SessionReview, ...SessionReview[]];
  change: { kind: "answer" | "toggle"; reviewId: string };
  editedAt: number;
};

/** What the server is asked to store for one answer or toggle: its review, and the card's state. */
export type RecordedAnswer = {
  cardId: CardId;
  review: SessionReview;
  change: "answer" | "toggle";
  state: CardState;
  editedAt: number;
};

/** Whether a write reached the server: once stored, the server's time then; when not, the sentence the user reads. */
export type WriteResult = { saved: true; savedAt: number } | { saved: false; message: string };

/** A write's result as the session sees it: once saved, the card's state the engine computed. */
export type SaveResult = { saved: true; state: CardState } | { saved: false; message: string };

/** Why a write did not reach the server, as the user is told. */
export const writeFailureMessages = {
  unreachable: "응답을 저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
  rejected: "로그인이 끝나 응답을 저장하지 못했어요. 다시 로그인한 뒤 다시 시도해 주세요.",
  failed: "서버가 응답을 받지 않았어요. 잠시 후 다시 시도해 주세요.",
  scheduling: "이 카드의 다음 복습 일정을 계산하지 못했어요. 일정은 바뀌지 않았어요.",
} as const;
