"use client";

import Link from "next/link";
import { type MouseEvent, useEffect, useRef } from "react";

import type { Completion } from "../session";

import { Mascot } from "@/design/brand";

/**
 * The completion panel in the current card's place once no card is left today, on the hero
 * surface (ADR 0151): the happy mascot beside the heading and the streak in large white text, three
 * tiles of today's answers and time, and the choice to go on with the new cards past today's,
 * through [onStudyOn], or to stop, through [onStop] before the link is followed; with none left, a
 * line saying so in place of going on, and stopping the panel's one primary. It takes the focus to
 * its first choice when it appears, so a keyboard reaches it at once.
 */
export function CompletionCard({
  completion,
  onStudyOn,
  back,
  onStop,
}: {
  completion: Completion;
  /** Goes on with the new cards past today's; null when none is left. */
  onStudyOn: (() => void) | null;
  /** Where "그만하기" leaves for: where the session was opened from. */
  back: string;
  /** Runs on "그만하기" before its link is followed, and may hold it back. */
  onStop: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const studyOn = useRef<HTMLButtonElement>(null);
  const stop = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    (studyOn.current ?? stop.current)?.focus();
  }, []);
  const minutes = Math.ceil(completion.timeSpentMs / 60_000);
  const action =
    "pressable flex items-center justify-center rounded-button px-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-hero";
  const tiles = [
    { count: String(completion.knowCount), colour: "text-know", name: "안다" },
    { count: String(completion.dontKnowCount), colour: "text-dont-know-text", name: "모른다" },
    { count: `${String(minutes)}분`, colour: "text-ink", name: "걸린 시간" },
  ];
  return (
    <section
      aria-labelledby="completion-title"
      className="flex flex-col gap-4 overflow-y-auto rounded-card bg-hero p-5 text-on-hero"
    >
      <div className="flex items-center gap-3">
        <Mascot expression="happy" className="size-mascot-guide shrink-0" />
        <div className="flex min-w-0 flex-col">
          <h2 id="completion-title" className="text-display">
            오늘 학습 완료
          </h2>
          {/* No flame: on the hero it would draw in the light surface's colours (ADR 0151). */}
          <p className="text-label">{completion.streak}일 연속</p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {tiles.map((tile) => (
          <div
            key={tile.name}
            className="flex flex-col-reverse justify-center rounded-row bg-surface px-2 py-3"
          >
            <dt className="text-secondary font-bold text-ink">{tile.name}</dt>
            <dd className={`truncate text-display ${tile.colour}`}>{tile.count}</dd>
          </div>
        ))}
      </dl>
      <div className="flex w-full flex-col gap-1">
        {onStudyOn ? (
          <button
            ref={studyOn}
            type="button"
            onClick={onStudyOn}
            className={`${action} min-h-cta bg-hero-button text-button text-on-hero-button`}
          >
            학습하기
          </button>
        ) : (
          <p className="py-2 text-center text-body">더 학습할 카드가 없어요</p>
        )}
        <Link
          ref={stop}
          href={back}
          onClick={onStop}
          className={
            onStudyOn
              ? `${action} min-h-tap-target text-label text-on-hero`
              : `${action} min-h-cta bg-hero-button text-button text-on-hero-button`
          }
        >
          그만하기
        </Link>
      </div>
    </section>
  );
}
