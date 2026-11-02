"use client";

import { Flame } from "lucide-react";
import Link from "next/link";
import { type MouseEvent, useEffect, useRef } from "react";

import type { Completion } from "../session";

import { Mascot } from "@/design/brand";

/**
 * The completion card in the current card's place once no card is left today: the happy mascot, the heading, today's answers, time and streak, and the choice to go on with the new cards past
 * today's, through [onStudyOn], or to stop, through [onStop] before the link is followed; with
 * none left, a line saying so in place of going on. It takes the focus to its first choice when it appears, so a keyboard reaches it at once.
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
  return (
    <section
      aria-labelledby="completion-title"
      className="flex flex-col items-center gap-3 rounded-card bg-surface px-5 pt-7 pb-5 text-center shadow-raised"
    >
      <Mascot expression="happy" className="size-mascot-medium" />
      <h2 id="completion-title" className="text-title">
        오늘 학습 완료
      </h2>
      <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-secondary text-ink-2">
        <span>
          <b className="text-know">{completion.knowCount}</b> 안다
        </span>
        <span>
          <b className="text-dont-know-text">{completion.dontKnowCount}</b> 모른다
        </span>
        <b className="text-ink">{minutes}분</b>
        <span className="flex items-center gap-1">
          <Flame aria-hidden className="size-small-icon text-streak" strokeWidth={2} />
          <span className="sr-only">연속 </span>
          <b className="text-ink">{completion.streak}일</b>
        </span>
      </p>
      <div className="mt-1 flex w-full flex-col gap-1">
        {onStudyOn ? (
          <button
            ref={studyOn}
            type="button"
            onClick={onStudyOn}
            className="pressable flex min-h-cta items-center justify-center rounded-button bg-primary px-6 text-button text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            학습하기
          </button>
        ) : (
          <p className="py-2 text-body text-ink-2">더 학습할 카드가 없어요</p>
        )}
        <Link
          ref={stop}
          href={back}
          onClick={onStop}
          className="pressable flex min-h-tap-target items-center justify-center rounded-button px-6 text-label text-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          그만하기
        </Link>
      </div>
    </section>
  );
}
