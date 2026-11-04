"use client";

import { useEffect, useRef } from "react";

import type { Completion } from "../session";

import { buttonClass } from "@/design/button";
import { Sheet } from "@/design/sheet";

/**
 * Asks, once the day's cards are done, whether to go on, as the phone's sheet does: today's
 * cards, minutes and streak in one line, which the dialog is described by; then, while new cards
 * are left past today's, "이어서 더 할까요?" over "이어서 하기", which calls [onStudyOn], and
 * "그만하기", the one primary; with none left, a line saying so over "완료" alone. Stopping,
 * "닫기", a click on the scrim, Escape and the browser's back all call [onStop]. The primary
 * takes the focus.
 */
export function CompletionSheet({
  completion,
  onStudyOn,
  onStop,
}: {
  completion: Completion;
  /** Goes on with the new cards past today's; null when none is left. */
  onStudyOn: (() => void) | null;
  onStop: () => void;
}) {
  const primary = useRef<HTMLButtonElement>(null);
  // After the sheet's own effect has opened it, which focuses its first control.
  useEffect(() => {
    primary.current?.focus();
  }, []);
  const minutes = Math.ceil(completion.timeSpentMs / 60_000);
  return (
    <Sheet
      title="오늘 학습을 다 했어요"
      description={`${String(completion.cards)}장 · ${String(minutes)}분 · ${String(completion.streak)}일 연속`}
      close={onStop}
    >
      <p className="mt-4 text-body break-keep">
        {onStudyOn ? "이어서 더 할까요?" : "더 학습할 카드가 없어요"}
      </p>
      <div className="mt-6 flex flex-col gap-2">
        {onStudyOn && (
          <button type="button" onClick={onStudyOn} className={buttonClass("secondary", "cta")}>
            이어서 하기
          </button>
        )}
        <button
          ref={primary}
          type="button"
          onClick={onStop}
          className={buttonClass("primary", "cta")}
        >
          {onStudyOn ? "그만하기" : "완료"}
        </button>
      </div>
    </Sheet>
  );
}
