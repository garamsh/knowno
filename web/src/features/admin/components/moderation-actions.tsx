import { dismissReports } from "../dismiss-reports";
import { hideDeck } from "../hide-deck";
import { removeDeck } from "../remove-deck";
import { unhideDeck } from "../unhide-deck";
import { ConfirmAction } from "./confirm-action";
import { ReasonAction } from "./reason-action";

/** A note as its moderation actions name it: its id and name. */
type Note = { id: string; name: string };

/** 숨기기, or 숨김 해제 on a [hidden] note, each asked first; [compact] in a row. */
export function HideAction({
  note,
  hidden,
  compact = false,
}: {
  note: Note;
  hidden: boolean;
  compact?: boolean;
}) {
  return hidden ? (
    <ConfirmAction
      compact={compact}
      label="숨김 해제"
      question={`'${note.name}' 노트를 공개 목록에 다시 보일까요?`}
      confirmLabel="숨김 해제"
      action={unhideDeck.bind(null, note.id)}
    />
  ) : (
    <ConfirmAction
      compact={compact}
      label="숨기기"
      question={`'${note.name}' 노트를 공개 목록에서 숨길까요?`}
      confirmLabel="숨기기"
      action={hideDeck.bind(null, note.id)}
    />
  );
}

/**
 * The dismissal of a note's [reports], asked first, named [label]: 문제없음 on a 노트 row and
 * 신고 정리 on the note's page (`web-admin.md`); disabled while there is none.
 */
export function DismissAction({
  note,
  reports,
  label,
  compact = false,
}: {
  note: Note;
  reports: number;
  label: "문제없음" | "신고 정리";
  compact?: boolean;
}) {
  return (
    <ConfirmAction
      compact={compact}
      disabled={reports === 0}
      label={label}
      question={`'${note.name}' 노트의 신고 ${String(reports)}건을 정리할까요? 숨김은 그대로예요.`}
      confirmLabel={label}
      action={dismissReports.bind(null, note.id)}
    />
  );
}

/** 공유에서 영구 삭제, which asks for a reason and ends on the red final button; [compact] in a menu. */
export function RemoveAction({ note, compact = false }: { note: Note; compact?: boolean }) {
  return (
    <ReasonAction
      compact={compact}
      label="공유에서 영구 삭제"
      reasonLabel="삭제하는 이유"
      question={`'${note.name}' 노트를 공유에서 영구 삭제할까요? 노트는 주인에게 남고, 다시 공개할 수 없어요.`}
      confirmLabel="영구 삭제"
      final
      action={removeDeck.bind(null, note.id)}
    />
  );
}
