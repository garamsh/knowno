"use client";

import { Check, X } from "lucide-react";
import type { ReactNode, Ref } from "react";

import { Chip } from "@/design/chip";

import type { Answer } from "../answer-write";
import { useSwipe } from "../hooks/use-swipe";
import type { PreviousAnswer } from "../session";

/** Each grade's name, the line a previous card takes in it, its chip's tone, and its mark. */
export const grades = {
  know: {
    name: "안다",
    line: "border-know",
    tone: "know",
    Mark: Check,
  },
  dontKnow: {
    name: "모른다",
    line: "border-dont-know-text",
    tone: "dontKnow",
    Mark: X,
  },
} as const;

/** An answered card as the stack shows it: its card, its answer, and whether it was changed. */
type Graded = Pick<PreviousAnswer, "card" | "answer"> & { changed?: boolean };

/**
 * What a screen reader reads for an answered card: its sides, a whole card's front with its
 * blanks as "빈칸", and its grade.
 */
export function answerLabel(answer: Graded): string {
  const front = answer.card.whole?.spokenFront ?? answer.card.text.front;
  const changed = answer.changed ? ". 수정됨" : "";
  return `앞면: ${front}. 뒷면: ${answer.card.text.back}. 응답: ${grades[answer.answer].name}${changed}`;
}

/**
 * What a screen reader reads for the previous card: "방금 본 카드" and its grade first, then its
 * sides, as on the phone (ADR 0151).
 */
export function previousLabel(answer: Graded): string {
  const front = answer.card.whole?.spokenFront ?? answer.card.text.front;
  const changed = answer.changed ? ". 수정됨" : "";
  return `방금 본 카드, ${grades[answer.answer].name}. 앞면: ${front}. 뒷면: ${answer.card.text.back}${changed}`;
}

/**
 * A previous card's face (ADR 0151): [front] over [back], or a whole card's one face as [front],
 * in one column centred both ways by auto margins, scrolling inside from its top where it is
 * taller, so a long answer is never cut, on the surface inside a 3 px line in [answer]'s colour.
 */
export function GradedFace({
  answer,
  front,
  back,
  className = "",
}: {
  answer: Answer;
  front: ReactNode;
  back?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`flex size-full flex-col overflow-y-auto rounded-previous border-3 bg-surface p-4 text-center lg:p-6 ${grades[answer].line} ${className}`}
    >
      <span className="mt-auto text-deck-name break-keep wrap-break-word text-ink">
        {front}
      </span>
      {back !== undefined && (
        <span className="mt-2 text-card-body break-keep wrap-break-word text-ink-2">{back}</span>
      )}
      <span aria-hidden className="mb-auto" />
    </span>
  );
}

/**
 * A grade's chip, its mark and its word, beside an answer in the whole card's dialog and the
 * session's list. A previous card shows its grade by its fill and line alone (ADR 0105).
 */
export function GradeChip({ answer }: { answer: Answer }) {
  const { name, tone, Mark } = grades[answer];
  return (
    <span aria-hidden>
      <Chip tone={tone} leading={<Mark className="size-3" strokeWidth={3} />}>
        {name}
      </Chip>
    </span>
  );
}

/** The card's tilt, in radians, per pixel of swipe, as on the phone. */
export const tiltPerPixel = 0.0006;

/** Each answer's tint behind a card moved toward it, on the side the card leaves bare. */
export const answerTints = {
  know: "justify-start bg-tint-green text-on-know-tint",
  dontKnow: "justify-end bg-tint-red text-on-dont-know-tint",
} as const;

/** What a swipe toward an answer shows behind the previous card. */
const reveals = {
  know: { text: "안다로 바꿔요", tint: answerTints.know },
  dontKnow: { text: "모른다로 바꿔요", tint: answerTints.dontKnow },
} as const;

/**
 * The card answered just before the current one ([GradedFace]): its front over its back, or a whole
 * card with its blanks filled, its grade by its line alone, with no chip: its accessible name names
 * the grade first. A click opens the whole card. A horizontal touch swipe ([useSwipe]) follows the
 * finger, shows the answer it would give behind it, and toward the other answer changes to it; a
 * vertical one scrolls the card where it is taller, and the page otherwise. [onLean] follows how
 * far a swipe has moved it. Without [onRedecide] it is not changed from here, and [label] names it
 * above its sides.
 */
export function GradedCard({
  answer,
  onRedecide,
  onOpen,
  openRef,
  label,
  onLean,
}: {
  answer: Graded;
  onRedecide?: (answer: Answer) => void;
  onOpen: () => void;
  openRef?: Ref<HTMLButtonElement>;
  label?: string;
  onLean?: (offset: number) => void;
}) {
  const { offset, dragging, toward, handlers, endsSwipe } = useSwipe({
    held: answer.answer,
    onCommit: onRedecide,
    onMove: onLean,
  });
  const reveal = toward !== null && toward !== answer.answer ? reveals[toward] : null;

  return (
    <article
      aria-label={label ? `${label}. ${answerLabel(answer)}` : previousLabel(answer)}
      {...handlers}
      className="relative flex w-full touch-pan-y"
    >
      {reveal && (
        <div
          aria-hidden
          className={`absolute inset-0 flex items-center rounded-previous px-5 text-secondary font-bold ${reveal.tint}`}
        >
          {reveal.text}
        </div>
      )}
      <button
        ref={openRef}
        type="button"
        aria-label="카드 전체 보기"
        aria-haspopup="dialog"
        onClick={() => {
          if (endsSwipe()) return;
          onOpen();
        }}
        style={{
          transform: `translateX(${String(offset)}px) rotate(${String(offset * tiltPerPixel)}rad)`,
        }}
        className={`pressable relative flex w-full rounded-previous focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink ${dragging ? "" : "motion-safe:transition-transform motion-safe:duration-300"}`}
      >
        {label && (
          <span aria-hidden className="absolute bottom-3 left-4 z-10 text-micro text-muted">
            {label}
          </span>
        )}
        {answer.card.whole ? (
          <GradedFace answer={answer.answer} front={answer.card.whole.filled} />
        ) : (
          <GradedFace
            answer={answer.answer}
            front={answer.card.sides?.front ?? answer.card.text.front}
            back={answer.card.sides?.back ?? answer.card.text.back}
          />
        )}
      </button>
    </article>
  );
}
