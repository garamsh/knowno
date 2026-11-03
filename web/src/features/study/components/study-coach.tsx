import type { ReactNode } from "react";

import { Mascot } from "@/design/brand";

import { coachHand } from "./coach-hand-drawing";

import type { Answer } from "../answer-write";
import { answerTints, GradedFace, grades } from "./graded-card";

/** The coach's steps: answering "안다", answering "모른다", and changing an answered card. */
export const coachSteps = ["know", "dontKnow", "redecide"] as const;

export type CoachStep = (typeof coachSteps)[number];

/** The key under which the browser keeps that the coach has shown on this device. */
export const coachShownKey = "studyCoachShown";

/**
 * Each step's line, true to the web's controls: the answers by their buttons and keys, and a
 * change by "마지막 응답 바꾸기" or Z, which work with a mouse as with a keyboard; by touch, the
 * phone's lines, since both cards take its swipes.
 */
export const coachLines: Record<"pointer" | "touch", Record<CoachStep, string>> = {
  pointer: {
    know: "알면 안다(→)를 눌러요",
    dontKnow: "모르면 모른다(←)를 눌러요",
    redecide: "응답한 카드는 위로 올라와요. '마지막 응답 바꾸기'나 Z로 응답을 바꿀 수 있어요",
  },
  touch: {
    know: "알면 오른쪽으로 밀어요",
    dontKnow: "모르면 왼쪽으로 밀어요",
    redecide: "응답한 카드는 위로 올라와요. 밀어서 응답을 바꿀 수 있어요",
  },
};

const button =
  "pressable inline-flex items-center justify-center rounded-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/**
 * How the pointer coach marks the control its step names: a ring in the hero's colour, held, and
 * a press of the control just before the card moves, as an answer by it does; under reduce motion
 * the ring alone, held.
 */
export const coachHighlight =
  "outline-3 outline-offset-3 outline-hero motion-safe:animate-coach-press";

/**
 * The coach, presented by the mascot in its own face: its caption a speech bubble beside it, on the
 * surface on its edge with a tail toward it, in the answer buttons' place. The bubble holds the
 * step's line, then "이전", off on the first step, a dot for each step with this one drawn long,
 * and "다음", the last step's "시작하기". The mascot and the bubble rise in as the coach starts,
 * or show at once under reduce motion. What a screen reader hears as the step changes is
 * [coachAnnouncement], in a live region the screen keeps mounted.
 */
export function CoachCaption({
  step,
  touch,
  onPrevious,
  onNext,
}: {
  step: CoachStep;
  touch: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const index = coachSteps.indexOf(step);
  const last = index === coachSteps.length - 1;
  return (
    <section
      aria-label="학습 사용 방법"
      className="flex items-end gap-2 motion-safe:transition-[opacity,translate] motion-safe:duration-300 motion-safe:ease-out motion-safe:starting:translate-y-4 motion-safe:starting:opacity-0"
    >
      <Mascot expression="thinking" className="size-14 shrink-0" />
      <div
        data-testid="coach-bubble"
        className="relative min-w-0 flex-1 rounded-row bg-surface px-3 pt-3 pb-2"
      >
        {/* The tail toward the mascot, a square turned on its corner. */}
        <span
          aria-hidden
          className="absolute bottom-4 -left-2 size-4.5 rotate-45 rounded-xs bg-surface"
        />
        <p className="relative text-body-strong text-ink">
          {coachLines[touch ? "touch" : "pointer"][step]}
        </p>
        {/* In one row where they fit; wrapped where a large text size leaves them no room. */}
        <div className="relative mt-2 flex flex-wrap items-center justify-between gap-x-2">
          <button
            type="button"
            onClick={onPrevious}
            disabled={index === 0}
            className={`${button} min-h-tap-target px-3 text-label text-ink-2 disabled:opacity-35`}
          >
            이전
          </button>
          <div aria-hidden className="flex shrink-0 gap-1">
            {coachSteps.map((dot) => (
              <span
                key={dot}
                className={`h-1.5 rounded-full motion-safe:transition-[width] ${dot === step ? "w-4 bg-accent" : "w-1.5 bg-edge"}`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={onNext}
            className={`${button} min-h-button bg-primary px-6 text-button text-on-primary`}
          >
            {last ? "시작하기" : "다음"}
          </button>
        </div>
      </div>
    </section>
  );
}

/** What a screen reader hears for [step]: the step of how many, and its line. */
export function coachAnnouncement(step: CoachStep, touch: boolean): string {
  return `사용 방법, ${String(coachSteps.length)}단계 중 ${String(coachSteps.indexOf(step) + 1)}단계. ${coachLines[touch ? "touch" : "pointer"][step]}`;
}

/**
 * The coach's touch, moving with the card it demonstrates on: the brand's pointing hand
 * ([coachHand]), in the surface on a hard edge with ink lines, its fingertip on a ring in the accent around a solid dot, over a soft fill, on a hard edge, and a
 * dashed trail [trail] long back to where the touch began, toward [from], drawn out as the card
 * moves; under reduce motion held where the card is out. Hidden from screen readers.
 */
function Touch({
  className,
  from,
  trail,
}: {
  className: string;
  from: "left" | "right";
  trail: string;
}) {
  return (
    <div
      aria-hidden
      data-testid="coach-touch"
      className={`pointer-events-none absolute size-10 motion-safe:animate-coach-touch motion-reduce:animate-coach-touch-held ${className}`}
    >
      <span
        data-testid="coach-trail"
        className={`absolute top-1/2 h-1.5 -translate-y-1/2 bg-[repeating-linear-gradient(90deg,var(--color-accent)_0_10px,transparent_10px_18px)] opacity-55 motion-safe:animate-coach-trail motion-reduce:animate-coach-trail-held ${trail} ${from === "left" ? "right-1/2 origin-right" : "left-1/2 origin-left"}`}
      />
      <span className="absolute inset-0 flex items-center justify-center rounded-full border-4 border-accent bg-accent/18 shadow-[0_4px_0_color-mix(in_srgb,var(--color-primary-edge)_35%,transparent)]">
        <span className="size-3 rounded-full bg-accent" />
      </span>
      {/* Its fingertip on the ring's centre. */}
      <svg
        viewBox={`0 0 ${String(coachHand.box)} ${String(coachHand.box)}`}
        data-testid="coach-hand"
        className="absolute size-11 overflow-visible"
        style={{
          left: `calc(50% - ${String((44 * coachHand.tip.x) / coachHand.box)}px)`,
          top: `calc(50% - ${String((44 * coachHand.tip.y) / coachHand.box)}px)`,
        }}
      >
        <path
          d={coachHand.outline}
          transform={`translate(${String(coachHand.edge.x)} ${String(coachHand.edge.y)})`}
          className="fill-edge"
        />
        <g
          className="stroke-ink"
          strokeWidth={coachHand.line}
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <path d={coachHand.outline} className="fill-surface" />
          <path d={coachHand.creases} fill="none" />
        </g>
      </svg>
    </div>
  );
}

/** What each answer's demonstration moves the card by, and the tint and name it shows. */
const demos = {
  know: {
    card: "motion-safe:animate-coach-know motion-reduce:animate-coach-know-held",
    tint: answerTints.know,
  },
  dontKnow: {
    card: "motion-safe:animate-coach-dont-know motion-reduce:animate-coach-dont-know-held",
    tint: answerTints.dontKnow,
  },
} as const;

/**
 * The coach's demonstration of [answer] on the current card, [children]: it moves toward the
 * answer and back over the answer's tint and name, or under reduce motion holds there. By touch a
 * hand drags it, as on the phone; with a pointer no hand shows, and the move follows the press
 * of the answer's button, which the screen marks with [coachHighlight]. Hidden from screen
 * readers, which read the caption.
 */
export function CoachDemo({
  answer,
  touch,
  children,
}: {
  answer: Answer;
  touch: boolean;
  children: ReactNode;
}) {
  const demo = demos[answer];
  return (
    <div data-testid="coach-demo" data-answer={answer} className="relative grid">
      <div
        aria-hidden
        className={`absolute inset-0 flex items-center rounded-card px-6 text-secondary font-bold motion-safe:animate-coach-tint motion-reduce:animate-coach-tint-held ${demo.tint}`}
      >
        {grades[answer].name}
      </div>
      <div className={`relative grid ${demo.card}`}>
        {children}
        {touch && (
          <Touch
            className="top-3/5 left-2/5"
            from={answer === "know" ? "left" : "right"}
            trail="w-24"
          />
        )}
      </div>
    </div>
  );
}

/**
 * The coach's last step in the previous card's place: a sample card answered "안다", moved toward
 * "모른다" and back, over what that change shows behind it, or under reduce motion held there. By
 * touch a hand drags it; with a pointer the move follows the press of "마지막 응답 바꾸기",
 * which the screen marks with [coachHighlight]. Hidden from screen readers, which read the
 * caption.
 */
export function CoachSample({ touch }: { touch: boolean }) {
  return (
    <div aria-hidden data-testid="coach-sample" className="relative flex w-full">
      <div className="absolute inset-0 flex items-center justify-end rounded-previous bg-tint-red px-5 text-secondary font-bold text-on-dont-know-tint motion-safe:animate-coach-tint motion-reduce:animate-coach-tint-held">
        모른다로 바꿔요
      </div>
      <div className="relative flex w-full motion-safe:animate-coach-change motion-reduce:animate-coach-change-held">
        <GradedFace answer="know" front="deadline" back="마감 기한" />
        {touch && <Touch className="right-16 bottom-8" from="right" trail="w-35" />}
      </div>
    </div>
  );
}
