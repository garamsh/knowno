import { Ellipsis } from "lucide-react";
import Link from "next/link";

import { Chip } from "@/design/chip";

import { dismissReports } from "../dismiss-reports";
import { hideDeck } from "../hide-deck";
import { labelOf, reasonLabels } from "../labels";
import type { NoteRow } from "../read-admin";
import { removeDeck } from "../remove-deck";
import { unhideDeck } from "../unhide-deck";
import { button, Empty, group } from "./admin-section";
import { ConfirmAction } from "./confirm-action";
import { ReasonAction } from "./reason-action";

/**
 * One public note: its name with its reports and state, its owner and counts, and three actions
 * fixed in place, 카드 보기, 문제없음 and 숨기기 (숨김 해제 on a hidden note), each asked first; under
 * ⋯ the owner's page and the removal from sharing, whose last step is red.
 */
function NoteItem({ note }: { note: NoteRow }) {
  return (
    <li className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body-strong break-words">{note.name}</span>
          {note.reports > 0 && <Chip tone="amber">신고 {note.reports}</Chip>}
          {note.hidden && <Chip tone="amber">숨김</Chip>}
        </div>
        <p className="text-caption text-ink-2">
          {note.owner.email} · 카드 {note.cards.toLocaleString("ko-KR")}장 · 가져오기{" "}
          {note.copies.toLocaleString("ko-KR")}회
          {note.reasons.length === 0
            ? ""
            : ` · 사유: ${note.reasons.map((reason) => labelOf(reasonLabels, reason)).join(", ")}`}
        </p>
      </div>
      <div className="flex flex-col items-start gap-2 lg:items-end">
        <div className="flex flex-wrap items-start gap-2 lg:justify-end">
          <Link href={`/admin/decks/${note.id}`} className={button.row}>
            카드 보기
          </Link>
          <ConfirmAction
            compact
            disabled={note.reports === 0}
            label="문제없음"
            question={`'${note.name}' 노트의 신고 ${String(note.reports)}건을 정리할까요? 숨김은 그대로예요.`}
            confirmLabel="문제없음"
            action={dismissReports.bind(null, note.id)}
          />
          {note.hidden ? (
            <ConfirmAction
              compact
              label="숨김 해제"
              question={`'${note.name}' 노트를 공개 목록에 다시 보일까요?`}
              confirmLabel="숨김 해제"
              action={unhideDeck.bind(null, note.id)}
            />
          ) : (
            <ConfirmAction
              compact
              label="숨기기"
              question={`'${note.name}' 노트를 공개 목록에서 숨길까요?`}
              confirmLabel="숨기기"
              action={hideDeck.bind(null, note.id)}
            />
          )}
          <details className="open:basis-full">
            <summary
              aria-label={`'${note.name}' 더 보기`}
              className={`${button.row} list-none [&::-webkit-details-marker]:hidden`}
            >
              <Ellipsis aria-hidden className="size-5" strokeWidth={2} />
            </summary>
            <NoteMenu note={note} />
          </details>
        </div>
      </div>
    </li>
  );
}

/** What ⋯ opens under a note's actions: the owner's page and the removal from sharing. */
function NoteMenu({ note }: { note: NoteRow }) {
  return (
    <div className="mt-2 flex flex-col items-start gap-2 lg:items-end">
      <Link href={`/admin/users/${note.owner.id}`} className={button.row}>
        만든 사람 보기
      </Link>
      <ReasonAction
        compact
        label="공유에서 영구 삭제"
        reasonLabel="삭제하는 이유"
        question={`'${note.name}' 노트를 공유에서 영구 삭제할까요? 노트는 주인에게 남고, 다시 공개할 수 없어요.`}
        confirmLabel="영구 삭제"
        final
        action={removeDeck.bind(null, note.id)}
      />
    </div>
  );
}

/** The notes of one view of 노트, each with its actions, or what is true when there are none. */
export function NoteList({ notes, empty }: { notes: NoteRow[]; empty: string }) {
  if (notes.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul aria-label="노트 목록" className={group}>
      {notes.map((note) => (
        <NoteItem key={note.id} note={note} />
      ))}
    </ul>
  );
}
