"use client";

import { useEffect, useRef } from "react";

import type { PreviousAnswer } from "../session";
import { answerLabel, GradeChip } from "./graded-card";

/**
 * Beside the cards on a wide screen: this session's answers, oldest first, with the count of
 * each, every one a button that changes it to the other answer. It is no taller than the screen,
 * its list scrolling on its own, and scrolls to the newest answer as each is added.
 */
export function AnswerList({
  answers,
  onToggle,
}: {
  answers: PreviousAnswer[];
  onToggle: (position: number) => void;
}) {
  const know = answers.filter(({ answer }) => answer === "know").length;
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const shown = list.current;
    if (shown) shown.scrollTop = shown.scrollHeight;
  }, [answers.length]);
  return (
    <aside
      aria-label="이번 학습"
      className="sticky top-[calc(1.5rem+var(--photo-import-bar,0px))] hidden max-h-[calc(100dvh-3rem-var(--photo-import-bar,0px))] w-full max-w-85 shrink-0 flex-col gap-2 self-start rounded-card bg-surface p-4 lg:flex"
    >
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-label">이번 학습</h2>
        <span className="text-caption text-ink-2">
          안다 {know} · 모른다 {answers.length - know}
        </span>
      </div>
      <p id="toggle-hint" className="sr-only">
        누르면 응답이 바뀌어요.
      </p>
      <ol ref={list} className="-m-1 flex min-h-0 flex-col gap-1 overflow-y-auto p-1">
        {answers.map((answer) => (
          <li key={answer.position}>
            <button
              type="button"
              onClick={() => {
                onToggle(answer.position);
              }}
              aria-label={answerLabel(answer)}
              aria-describedby="toggle-hint"
              title="눌러서 응답 바꾸기"
              className="pressable flex min-h-tap-target w-full items-center gap-3 rounded-field text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <span className="flex-1 truncate text-secondary font-bold">
                {answer.card.text.front}
              </span>
              <GradeChip answer={answer.answer} />
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
