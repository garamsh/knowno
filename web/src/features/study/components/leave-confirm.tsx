"use client";

import { Confirm } from "@/design/confirm";
import { leaveThen } from "@/design/use-back-entry";

/**
 * Asks before leaving the study page with [count] answers the server has not saved: "취소"
 * stays, and "나가기", the red final button, leaves without them once the confirm's history entry
 * is dropped. A click outside, Esc or the browser's back stays.
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
  return (
    <Confirm
      title="저장하지 않고 나갈까요?"
      consequence={`지금 나가면 저장하지 못한 응답 ${String(count)}개가 사라져요.`}
      confirmLabel="나가기"
      destructive
      onConfirm={() => {
        leaveThen(onLeave);
      }}
      close={onStay}
    />
  );
}
