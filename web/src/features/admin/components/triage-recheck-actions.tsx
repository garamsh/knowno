"use client";

import { recheckTriageAction } from "../recheck-triage-action";
import { ConfirmAction } from "./confirm-action";

/** 맞아요 and 아니에요 for a sampled AI action: whether the admin, looking again, agrees with it. */
export function TriageRecheckActions({ actionId, name }: { actionId: number; name: string }) {
  return (
    <div className="flex flex-wrap items-start gap-2 [&>*:has([role=group])]:basis-full">
      <ConfirmAction
        compact
        label="맞아요"
        question={`'${name}' 에 대한 AI의 처리가 맞다고 남길까요?`}
        confirmLabel="맞아요"
        action={recheckTriageAction.bind(null, actionId, true)}
      />
      <ConfirmAction
        compact
        label="아니에요"
        question={`'${name}' 에 대한 AI의 처리가 틀렸다고 남길까요?`}
        confirmLabel="아니에요"
        action={recheckTriageAction.bind(null, actionId, false)}
      />
    </div>
  );
}
