import { unpublishDeck } from "../unpublish-deck";
import type { DeckState } from "../read-admin";
import { ConfirmAction } from "./confirm-action";
import { DismissAction, HideAction } from "./moderation-actions";

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
      <HideAction note={{ id, name }} hidden={state.hidden} />
      {state.visibility === "public" && (
        <ConfirmAction
          label="비공개로 전환"
          question={`'${name}' 노트를 비공개로 바꿀까요? 주인이 다시 공개할 수 있어요.`}
          confirmLabel="비공개로 전환"
          action={unpublishDeck.bind(null, id)}
        />
      )}
      {reports > 0 && <DismissAction note={{ id, name }} reports={reports} label="신고 정리" />}
    </div>
  );
}
