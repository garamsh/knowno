import { Pointer } from "lucide-react";
import type { ReactNode } from "react";

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
  "pressable inline-flex min-h-tap-target items-center justify-center rounded-button px-5 text-secondary font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-hero";

/**
 * The coach's caption on the hero surface in the answer buttons' place: the step's line, a dot
 * for each step with this one drawn long, "건너뛰기" and "다음", the last step's "시작하기". What
 * a screen reader hears as the step changes is [coachAnnouncement], in a live region the screen
 * keeps mounted.
 */
export function CoachCaption({
  step,
  touch,
  onNext,
  onSkip,
}: {
  step: CoachStep;
  touch: boolean;
  onNext: () => void;
  onSkip: () => void;
}) {
  const last = coachSteps.indexOf(step) === coachSteps.length - 1;
  return (
    <section
      aria-label="학습 사용 방법"
      className="flex flex-col gap-2 rounded-card bg-hero px-5 pt-4 pb-3 text-on-hero shadow-card"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-body-strong">{coachLines[touch ? "touch" : "pointer"][step]}</p>
        <div aria-hidden className="flex shrink-0 gap-1">
          {coachSteps.map((dot) => (
            <span
              key={dot}
              className={`h-1.5 rounded-full bg-on-hero motion-safe:transition-[width] ${dot === step ? "w-4" : "w-1.5 opacity-40"}`}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <button type="button" onClick={onSkip} className={`${button} -ml-1 px-1 opacity-80`}>
          건너뛰기
        </button>
        <button
          type="button"
          onClick={onNext}
          className={`${button} bg-hero-button text-on-hero-button`}
        >
          {last ? "시작하기" : "다음"}
        </button>
      </div>
    </section>
  );
}

/** What a screen reader hears for [step]: the step of how many, and its line. */
export function coachAnnouncement(step: CoachStep, touch: boolean): string {
  return `사용 방법, ${String(coachSteps.length)}단계 중 ${String(coachSteps.indexOf(step) + 1)}단계. ${coachLines[touch ? "touch" : "pointer"][step]}`;
}

/** The coach's finger, moving with the card it demonstrates on; hidden from screen readers. */
function Finger({ className }: { className: string }) {
  return (
    <Pointer
      aria-hidden
      data-testid="coach-finger"
      className={`pointer-events-none absolute size-8 fill-surface text-ink drop-shadow-md motion-safe:animate-coach-finger motion-reduce:animate-coach-finger-held ${className}`}
      strokeWidth={1.4}
    />
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
 * answer and back over the answer's tint and name, under a finger, or under reduce motion holds
 * there. Hidden from screen readers, which read the caption.
 */
export function CoachDemo({ answer, children }: { answer: Answer; children: ReactNode }) {
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
        <Finger className="top-3/5 left-2/5" />
      </div>
    </div>
  );
}

/**
 * The coach's last step in the previous card's place: a sample card answered "안다", dragged
 * toward "모른다" by a finger and back, over what that change shows behind it, or under reduce
 * motion held there. Hidden from screen readers, which read the caption.
 */
export function CoachSample() {
  return (
    <div aria-hidden data-testid="coach-sample" className="relative flex w-full">
      <div className="absolute inset-0 flex items-center justify-end rounded-previous bg-tint-red px-5 text-secondary font-bold text-on-dont-know-tint motion-safe:animate-coach-tint motion-reduce:animate-coach-tint-held">
        모른다로 바꿔요
      </div>
      <div className="relative flex w-full motion-safe:animate-coach-change motion-reduce:animate-coach-change-held">
        <GradedFace answer="know" front="deadline" back="마감 기한" />
        <Finger className="right-16 bottom-8" />
      </div>
    </div>
  );
}
