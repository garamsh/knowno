"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { type MouseEvent, type Ref, useEffect, useState } from "react";

import { buttonClass } from "@/design/button";
import { Chip } from "@/design/chip";
import { FittedLine } from "@/design/fitted-line";

import type { SessionSize, SessionView } from "../session";
import { Hint } from "./key-hint";
import { coachAnnouncement, type CoachStep } from "./study-coach";

/** How long, in milliseconds, the notice that a session goes on with the day stays. */
const noticeMs = 3000;

/**
 * The study screen's top bar: the close, which leaves for [back] through [exit]; the progress of
 * [view] with its count and the chip of cards past the day's plan, where the notice that the
 * session goes on with the day, from [size], shows for a moment as it opens; "단축키", which
 * [openHelp]s; and the live region announcing the coach's steps.
 */
export function StudyHeader({
  back,
  exit,
  closeLink,
  size,
  view,
  helpButton,
  openHelp,
  coach,
  touch,
}: {
  back: string;
  exit: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  closeLink: Ref<HTMLAnchorElement>;
  size: SessionSize;
  view: SessionView;
  helpButton: Ref<HTMLButtonElement>;
  openHelp: () => void;
  coach: CoachStep | null;
  touch: boolean;
}) {
  /**
   * That the session goes on with the day, said for a moment as it opens: set after the status
   * region has mounted empty, so a screen reader announces it, and cleared after [noticeMs].
   */
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const { resumed, cards, minutes } = size;
    if (!resumed || cards === 0) return;
    const shown = window.setTimeout(() => {
      setNotice(`이어서 해요 · 남은 ${String(cards)}장 · 약 ${String(minutes)}분`);
    }, 0);
    const gone = window.setTimeout(() => {
      setNotice(null);
    }, noticeMs);
    return () => {
      window.clearTimeout(shown);
      window.clearTimeout(gone);
    };
  }, [size]);
  return (
    // The phone's top bar (study_screen.dart's _TopBar): the close 8 from the screen's edge, a 48
    // tap target as its IconButton's, 12 before the bar; the gutter less 12 is the 8.
    <header className="-ml-3 flex items-center gap-3">
      <Link
        ref={closeLink}
        href={back}
        onClick={(event) => {
          exit(event, back);
        }}
        aria-label="그만하기"
        aria-keyshortcuts="Escape"
        title="그만하기 (Esc)"
        className="pressable flex size-12 shrink-0 items-center justify-center rounded-full text-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <X aria-hidden className="size-5" strokeWidth={2.2} />
      </Link>
      <div className="relative flex flex-1 items-center gap-3">
        {/* In the progress bar's place while it shows, as on the phone (ADR 0093). */}
        <div
          role="status"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
        >
          {notice && (
            <FittedLine className="text-center">
              <span className="inline-block rounded-full bg-hero px-4 py-2 text-secondary text-on-hero shadow-card motion-safe:animate-resume-notice">
                {notice}
              </span>
            </FittedLine>
          )}
        </div>
        {view.kind !== "empty" && (
          <>
            <div
              role="progressbar"
              aria-label="진행"
              aria-valuemin={0}
              aria-valuemax={view.total}
              aria-valuenow={view.done}
              aria-valuetext={`${String(view.total)}장 중 ${String(view.done)}장 끝냄`}
              className={`h-progress flex-1 overflow-hidden rounded-full bg-edge ${notice ? "invisible" : ""}`}
            >
              <div
                className="h-full rounded-full bg-accent motion-safe:transition-[width]"
                style={{
                  width: `${String(view.total === 0 ? 100 : (100 * view.done) / view.total)}%`,
                }}
              />
            </div>
            <span aria-hidden className="text-secondary font-bold text-ink tabular-nums">
              {view.done}/{view.total}
            </span>
            {/* Cards past the day's plan are counted apart, so the day's bar never shrinks. */}
            {view.extra > 0 && (
              <Chip tone="brand">
                <span aria-hidden className="whitespace-nowrap">
                  추가 {view.extra}장
                </span>
                <span className="sr-only">오늘 계획 밖으로 {view.extra}장 더 학습함</span>
              </Chip>
            )}
          </>
        )}
      </div>
      <button
        ref={helpButton}
        type="button"
        onClick={openHelp}
        aria-keyshortcuts="?"
        className={`${buttonClass("secondary")} hidden lg:flex`}
      >
        단축키 <Hint>?</Hint>
      </button>
      {/* Mounted empty, so the coach's steps are announced as they show. */}
      <p aria-live="polite" className="sr-only">
        {coach ? coachAnnouncement(coach, touch) : ""}
      </p>
    </header>
  );
}
