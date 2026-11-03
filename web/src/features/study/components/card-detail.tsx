"use client";

import { useEffect, useRef } from "react";

import { buttonClass } from "@/design/button";
import { keepFocusInside } from "@/design/focus-trap";

import type { PreviousAnswer } from "../session";
import { CardSide } from "./card-side";
import { GradeChip, grades } from "./graded-card";
import { SoundControls } from "./sound-controls";

/**
 * The whole of a card answered earlier, front and back, or a whole card's front with its blanks
 * filled, each with its sounds' controls (ADR 0112), over the screen until it is closed by "닫기", Esc or a click outside it.
 */
export function CardDetail({
  answer,
  onClose,
}: {
  answer: Pick<PreviousAnswer, "card" | "answer">;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const sounds = answer.card.sounds;
  useEffect(() => {
    close.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-shadow/40 px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-detail-title"
        onKeyDown={keepFocusInside}
        className="flex max-h-[90dvh] w-full max-w-study flex-col gap-4 overflow-y-auto rounded-card bg-surface p-6"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id="card-detail-title" className="text-headline text-ink">
            카드
          </h2>
          <GradeChip answer={answer.answer} />
          <span className="sr-only">응답: {grades[answer.answer].name}</span>
        </div>
        {answer.card.whole ? (
          <>
            <div className="text-back">{answer.card.whole.filled}</div>
            {sounds && <SoundControls sounds={[...sounds.front, ...sounds.back]} />}
          </>
        ) : (
          <>
            <section aria-labelledby="card-detail-front" className="flex flex-col gap-2">
              <h3 id="card-detail-front" className="text-section text-muted">
                앞면
              </h3>
              {answer.card.sides ? (
                <div className="text-center text-front break-words">{answer.card.sides.front}</div>
              ) : (
                <CardSide blocks={answer.card.front} size="front" />
              )}
              {sounds && <SoundControls sounds={sounds.front} />}
            </section>
            <section aria-labelledby="card-detail-back" className="flex flex-col gap-2">
              <h3 id="card-detail-back" className="text-section text-muted">
                뒷면
              </h3>
              {answer.card.sides ? (
                <div className="text-center text-back break-words">{answer.card.sides.back}</div>
              ) : (
                <CardSide blocks={answer.card.back} size="back" />
              )}
              {sounds && <SoundControls sounds={sounds.back} />}
            </section>
          </>
        )}
        <button
          ref={close}
          type="button"
          onClick={onClose}
          aria-keyshortcuts="Escape"
          className={buttonClass("primary")}
        >
          닫기
        </button>
      </div>
    </div>
  );
}
