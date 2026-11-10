"use client";

import { allowDeck } from "../allow-deck";
import { keepDeckHidden } from "../keep-deck-hidden";
import { ConfirmAction } from "./confirm-action";
import { ReasonAction } from "./reason-action";

/**
 * 공개 허용 and 숨김 유지 for a held note, each asked first and each naming the content hash the
 * admin read, so the server refuses where the owner edited the note since. 숨김 유지 records a reason.
 */
export function ScreeningActions({
  id,
  name,
  contentHash,
}: {
  id: string;
  name: string;
  contentHash: string;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2 [&>*:has([role=group])]:basis-full">
      <ConfirmAction
        compact
        label="공개 허용"
        question={`'${name}' 노트를 공개할까요? 공개 목록에 바로 보여요.`}
        confirmLabel="공개 허용"
        action={allowDeck.bind(null, id, contentHash)}
      />
      <ReasonAction
        compact
        label="숨김 유지"
        reasonLabel="숨기는 이유"
        question={`'${name}' 노트를 계속 숨길까요? 주인에게는 운영자가 판단했다고만 알려요.`}
        confirmLabel="숨김 유지"
        action={keepDeckHidden.bind(null, id, contentHash)}
      />
    </div>
  );
}
