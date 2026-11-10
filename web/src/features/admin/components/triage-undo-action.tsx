"use client";

import { undoTriageAction } from "../undo-triage-action";
import { ConfirmAction } from "./confirm-action";

/**
 * 되돌리기 for one AI action, asked first: it unhides a note the AI hid, or restores the reports
 * it dismissed.
 */
export function TriageUndoAction({
  actionId,
  name,
  action,
}: {
  actionId: number;
  name: string;
  /** What the AI did: `hide` or `dismiss`. */
  action: string;
}) {
  return (
    <ConfirmAction
      compact
      label="되돌리기"
      question={
        action === "hide"
          ? `'${name}' 노트의 숨김을 풀까요? 공개 목록에 다시 보여요.`
          : `'${name}' 노트의 신고를 되살릴까요? AI가 정리한 신고가 다시 쌓여요.`
      }
      confirmLabel="되돌리기"
      action={undoTriageAction.bind(null, actionId)}
    />
  );
}
