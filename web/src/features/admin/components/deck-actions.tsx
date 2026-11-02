import { dismissReports } from "../dismiss-reports";
import { hideDeck } from "../hide-deck";
import { unhideDeck } from "../unhide-deck";
import { unpublishDeck } from "../unpublish-deck";
import type { DeckState } from "../read-admin";
import { ConfirmAction } from "./confirm-action";

/**
 * The moderation actions a deck offers in its state: hide or unhide, make a public deck private,
 * and dismiss its reports when it has any. Each asks first.
 */
export function DeckActions({
  id,
  name,
  state,
  reports,
}: {
  id: string;
  name: string;
  state: DeckState;
  reports: number;
}) {
  if (state.deleted) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {state.hidden ? (
        <ConfirmAction
          label="숨김 해제"
          question={`'${name}' 노트를 공개 목록에 다시 보일까요?`}
          confirmLabel="숨김 해제"
          action={unhideDeck.bind(null, id)}
        />
      ) : (
        <ConfirmAction
          label="숨기기"
          question={`'${name}' 노트를 공개 목록에서 숨길까요?`}
          confirmLabel="숨기기"
          action={hideDeck.bind(null, id)}
        />
      )}
      {state.visibility === "public" && (
        <ConfirmAction
          label="비공개로 전환"
          question={`'${name}' 노트를 비공개로 바꿀까요? 주인이 다시 공개할 수 있어요.`}
          confirmLabel="비공개로 전환"
          action={unpublishDeck.bind(null, id)}
        />
      )}
      {reports > 0 && (
        <ConfirmAction
          label="신고 정리"
          question={`'${name}' 노트의 신고 ${String(reports)}건을 정리할까요? 숨김은 그대로예요.`}
          confirmLabel="신고 정리"
          action={dismissReports.bind(null, id)}
        />
      )}
    </div>
  );
}
