"use client";

import { buttonSize } from "@/design/button";

import type { Answer } from "../answer-write";
import { Hint } from "./key-hint";
import { coachHighlight, type CoachStep } from "./study-coach";

/** An answer button's shape, under its own tint. */
const answerBase =
  "pressable flex items-center justify-center gap-2 rounded-button px-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50";

/**
 * "모른다" and "안다" under the current card, each with its keys, and the coach's replay between;
 * [highlight], the pointer coach's step, marks the answer it names. By touch the answers are left
 * to screen readers, as the phone gives them as actions, and the replay is alone under the card.
 */
export function AnswerButtons({
  touch,
  highlight,
  onAnswer,
  onGuide,
}: {
  touch: boolean;
  highlight: CoachStep | null;
  onAnswer: (answer: Answer) => void;
  onGuide: () => void;
}) {
  const answerButton = (step: CoachStep) =>
    touch
      ? "sr-only"
      : `${answerBase} ${buttonSize("cta")} flex-1 ${highlight === step ? coachHighlight : ""}`;
  return (
    <div className="flex justify-center gap-3">
      <button
        type="button"
        onClick={() => {
          onAnswer("dontKnow");
        }}
        aria-keyshortcuts="ArrowLeft"
        className={`${answerButton("dontKnow")} bg-tint-red text-on-dont-know-tint`}
      >
        모른다 <Hint>←</Hint>
      </button>
      <button
        type="button"
        onClick={onGuide}
        className="pressable min-h-tap-target shrink-0 rounded-button px-2 text-caption text-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        안내 다시 보기
      </button>
      <button
        type="button"
        onClick={() => {
          onAnswer("know");
        }}
        aria-keyshortcuts="ArrowRight"
        className={`${answerButton("know")} bg-tint-green text-on-know-tint`}
      >
        안다 <Hint>→</Hint>
      </button>
    </div>
  );
}
