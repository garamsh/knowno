import { Ellipsis } from "lucide-react";
import Link from "next/link";

import { Chip } from "@/design/chip";

import { formatDate } from "../format";
import { labelOf, reasonLabels } from "../labels";
import type { NoteRow } from "../read-admin";
import { button, Empty } from "./admin-section";
import { AdminTable, CellLabel, cellClass, rowClass } from "./admin-table";
import { DismissAction, HideAction, RemoveAction } from "./moderation-actions";

const head = [
  { label: "노트" },
  { label: "만든 사람" },
  { label: "카드", numeric: true },
  { label: "가져오기", numeric: true },
  { label: "첫 신고" },
  { label: "작업" },
] as const;

/**
 * One public note as a row: its name with its reports, state and reasons, its owner, counts and
 * first report, and three actions fixed in place, 카드 보기, 문제없음 and 숨기기 (숨김 해제 on a
 * hidden note), each asked first; under ⋯ the owner's page and the removal from sharing, whose
 * last step is red.
 */
function NoteItem({ note, timeZone }: { note: NoteRow; timeZone: string }) {
  return (
    <tr className={rowClass()}>
      <td className={`${cellClass({ lead: true })} lg:min-w-48`}>
        <span className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-body-strong break-words">{note.name}</span>
            {note.reports > 0 && <Chip tone="amber">신고 {note.reports}</Chip>}
            {note.hidden && <Chip tone="amber">숨김</Chip>}
          </span>
          {note.reasons.length > 0 && (
            <span className="text-caption text-ink-2">
              사유: {note.reasons.map((reason) => labelOf(reasonLabels, reason)).join(", ")}
            </span>
          )}
        </span>
      </td>
      <td className={`${cellClass()} break-all`}>{note.owner.email}</td>
      <td className={cellClass({ numeric: true })}>
        <CellLabel>카드</CellLabel>
        {note.cards.toLocaleString("ko-KR")}장
      </td>
      <td className={cellClass({ numeric: true })}>
        <CellLabel>가져오기</CellLabel>
        {note.copies.toLocaleString("ko-KR")}회
      </td>
      <td className={`${cellClass()} whitespace-nowrap`}>
        <CellLabel>첫 신고</CellLabel>
        {note.firstReportedAt === null ? "없음" : formatDate(note.firstReportedAt, timeZone)}
      </td>
      <td className={`${cellClass({ lead: true })} max-lg:pt-2`}>
        <div className="flex flex-wrap items-start gap-2 pb-2">
          <Link href={`/decks/${note.id}`} className={button.row}>
            카드 보기
          </Link>
          <DismissAction compact note={note} reports={note.reports} label="문제없음" />
          <HideAction compact note={note} hidden={note.hidden} />
          <details className="open:basis-full">
            <summary
              aria-label={`'${note.name}' 더 보기`}
              className={`${button.row} list-none [&::-webkit-details-marker]:hidden`}
            >
              <Ellipsis aria-hidden className="size-5" strokeWidth={2} />
            </summary>
            <div className="mt-2 flex flex-col items-start gap-2">
              <Link href={`/users/${note.owner.id}`} className={button.row}>
                만든 사람 보기
              </Link>
              <RemoveAction compact note={note} />
            </div>
          </details>
        </div>
      </td>
    </tr>
  );
}

/** The notes of one view of 노트 as a table, each with its actions, or what is true when there are none. */
export function NoteList({
  notes,
  empty,
  timeZone,
}: {
  notes: NoteRow[];
  empty: string;
  timeZone: string;
}) {
  if (notes.length === 0) return <Empty>{empty}</Empty>;
  return (
    <AdminTable label="노트 목록" head={head}>
      {notes.map((note) => (
        <NoteItem key={note.id} note={note} timeZone={timeZone} />
      ))}
    </AdminTable>
  );
}
