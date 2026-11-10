"use client";

import { resolveTriageAppeal } from "../resolve-triage-appeal";
import { ConfirmAction } from "./confirm-action";

/** 되돌리기 and 그대로 두기 for an owner's appeal: undo what the AI did, or let it stand. */
export function TriageAppealActions({ deckId, name }: { deckId: string; name: string }) {
  return (
    <div className="flex flex-wrap items-start gap-2 [&>*:has([role=group])]:basis-full">
      <ConfirmAction
        compact
        label="되돌리기"
        question={`'${name}' 노트를 AI가 처리하기 전으로 되돌릴까요? 숨겼다면 다시 보여요.`}
        confirmLabel="되돌리기"
        action={resolveTriageAppeal.bind(null, deckId, true)}
      />
      <ConfirmAction
        compact
        label="그대로 두기"
        question={`'${name}' 노트에 AI가 한 처리를 그대로 둘까요? 이의 신청은 처리된 것으로 남아요.`}
        confirmLabel="그대로 두기"
        action={resolveTriageAppeal.bind(null, deckId, false)}
      />
    </div>
  );
}
