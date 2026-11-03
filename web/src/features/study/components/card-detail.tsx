"use client";

import { Sheet } from "@/design/sheet";

import type { PreviousAnswer } from "../session";
import { CardSide } from "./card-side";
import { GradeChip, grades } from "./graded-card";
import { SoundControls } from "./sound-controls";

/**
 * The whole of a card answered earlier, front and back, or a whole card's front with its blanks
 * filled, each with its sounds' controls (ADR 0112), under its answer's chip, in the sheet until
 * it is closed by "닫기", Esc or a click outside it.
 */
export function CardDetail({
  answer,
  onClose,
}: {
  answer: Pick<PreviousAnswer, "card" | "answer">;
  onClose: () => void;
}) {
  const sounds = answer.card.sounds;

  return (
    <Sheet title="카드" close={onClose}>
      <div className="flex flex-col gap-4">
        <p>
          <GradeChip answer={answer.answer} />
          <span className="sr-only">응답: {grades[answer.answer].name}</span>
        </p>
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
      </div>
    </Sheet>
  );
}
