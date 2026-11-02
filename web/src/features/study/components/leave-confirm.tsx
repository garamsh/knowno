"use client";

import { useEffect, useRef } from "react";

import { keepFocusInside } from "@/design/focus-trap";

/**
 * Asks before leaving the study page with [count] answers the server has not saved: "취소"
 * stays, and "나가기", the red final button, leaves without them. A click outside, or Esc,
 * which the screen routes here, stays.
 */
export function LeaveConfirm({
  count,
  onStay,
  onLeave,
}: {
  count: number;
  onStay: () => void;
  onLeave: () => void;
}) {
  const stay = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    stay.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-shadow/40 px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onStay();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-confirm-title"
        aria-describedby="leave-confirm-body"
        onKeyDown={keepFocusInside}
        className="flex w-full max-w-sm flex-col gap-4 rounded-sheet bg-surface p-6 text-ink"
      >
        <h2 id="leave-confirm-title" className="text-headline">
          저장하지 않고 나갈까요?
        </h2>
        <p id="leave-confirm-body" className="text-secondary text-ink-2">
          지금 나가면 저장하지 못한 응답 {count}개가 사라져요.
        </p>
        <div className="flex flex-col gap-2">
          <button
            ref={stay}
            type="button"
            onClick={onStay}
            className="pressable flex min-h-button items-center justify-center rounded-button bg-surface px-5 text-button text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="pressable flex min-h-button items-center justify-center rounded-button bg-dont-know-text px-5 text-button text-on-dont-know-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            나가기
          </button>
        </div>
      </div>
    </div>
  );
}
