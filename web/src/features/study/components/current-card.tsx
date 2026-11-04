"use client";

import type { Answer } from "../answer-write";
import { useSwipe } from "../hooks/use-swipe";
import type { PreviousAnswer } from "../session";
import { cardHeight } from "./card-height";
import { CardScroll } from "./card-scroll";
import { CardSide } from "./card-side";
import { answerTints, grades, tiltPerPixel } from "./graded-card";
import { SoundControls } from "./sound-controls";

/**
 * The card under study, [cardHeight] high: its front alone, or a whole card's front with its
 * blanks as hatched boxes, and the front's sounds' controls under it (ADR 0112), in the largest of
 * the front's sizes, from the one its length starts at, at which it fits, scrolling inside past
 * the last ([CardScroll], ADR 0123, #635); its back shows once answered, above. A horizontal
 * touch swipe ([useSwipe]) moves and tilts it over the answer it would give, and released past
 * the phone's distance, or flung, gives [onAnswer] that answer; a vertical one scrolls the
 * card's content where it is taller than the card, and the page otherwise, and a mouse drags
 * nothing.
 */
export function CurrentCard({
  card,
  onAnswer,
}: {
  card: PreviousAnswer["card"];
  onAnswer: (answer: Answer) => void;
}) {
  const { offset, dragging, toward, handlers } = useSwipe({ onCommit: onAnswer });
  return (
    <section
      aria-label="현재 카드"
      {...handlers}
      className={`relative flex touch-pan-y ${cardHeight}`}
    >
      {toward && (
        <div
          aria-hidden
          className={`absolute inset-0 flex items-center rounded-card px-6 text-secondary font-bold ${answerTints[toward]}`}
        >
          {grades[toward].name}
        </div>
      )}
      <div
        style={{
          transform: `translateX(${String(offset)}px) rotate(${String(offset * tiltPerPixel)}rad)`,
        }}
        className={`relative flex flex-1 rounded-card bg-surface shadow-card ${dragging ? "" : "motion-safe:transition-transform motion-safe:duration-300"}`}
      >
        <div aria-label="앞면" role="group" className="flex min-h-0 flex-1 rounded-card">
          <CardScroll length={card.frontLength}>
            {card.whole ? (
              <div className="w-full">{card.whole.empty}</div>
            ) : card.sides ? (
              <div className="w-full">{card.sides.front}</div>
            ) : (
              <CardSide blocks={card.front} />
            )}
            {card.sounds && <SoundControls sounds={card.sounds.front} />}
          </CardScroll>
        </div>
      </div>
    </section>
  );
}
