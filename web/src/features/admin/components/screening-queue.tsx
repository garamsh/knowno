import Link from "next/link";

import { Chip } from "@/design/chip";

import { formatDate } from "../format";
import { findingLabels, holdLabels, labelOf, placeLabels } from "../labels";
import type { ReviewedHold, ScreeningFinding } from "../read-screening";
import { Email, Empty, group } from "./admin-section";
import { ScreeningActions } from "./screening-actions";

/** A finding: its category and where, then the passage with the flagged words marked. */
function Finding({ finding }: { finding: ScreeningFinding }) {
  const { passage } = finding;
  return (
    <li className="flex flex-col gap-1">
      <span className="text-caption text-ink-2">
        {labelOf(findingLabels, finding.category)} · {labelOf(placeLabels, finding.place)}
      </span>
      {passage !== null && (
        <span className="text-body break-words whitespace-pre-wrap">
          {passage.before}
          <mark className="rounded-sm bg-tint-amber px-0.5 text-ink">{passage.flagged}</mark>
          {passage.after}
        </span>
      )}
    </li>
  );
}

/** A held note: what it is, why it is held, what was found in it, and the two decisions. */
function Held({ note, timeZone }: { note: ReviewedHold; timeZone: string }) {
  const { detail } = note;
  return (
    <li className="flex flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/decks/${note.id}`}
          className="inline-flex min-h-tap-target items-center text-body-strong break-words underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          {note.name}
        </Link>
        <Chip tone="amber">검토 중</Chip>
        {note.reports > 0 && <Chip tone="amber">신고 {note.reports}</Chip>}
      </div>
      <p className="text-caption text-ink-2">
        <Email email={note.owner.email} /> · {formatDate(note.updatedAt, timeZone)}
      </p>
      <p className="text-body">
        {note.hold === null ? "사람의 확인이 필요해요." : labelOf(holdLabels, note.hold)}
      </p>
      {detail.changed && (
        <p className="text-body text-ink-2">
          목록을 읽은 뒤 노트가 바뀌었어요. 새로 고쳐서 바뀐 내용을 확인해 주세요.
        </p>
      )}
      {!detail.changed && detail.unscreened && (
        <p className="text-body text-ink-2">자동 검토가 아직 끝나지 않았어요.</p>
      )}
      {detail.findings.length > 0 && (
        <ul aria-label={`'${note.name}' 에서 찾은 것`} className="flex flex-col gap-3">
          {detail.findings.map((finding, index) => (
            <Finding key={index} finding={finding} />
          ))}
        </ul>
      )}
      <ScreeningActions id={note.id} name={note.name} contentHash={note.contentHash} />
    </li>
  );
}

/** The notes held for an admin's decision, each with its reasons and decisions, or [empty]. */
export function ScreeningQueue({
  notes,
  empty,
  timeZone,
}: {
  notes: ReviewedHold[];
  empty: string;
  timeZone: string;
}) {
  if (notes.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul aria-label="검토 중인 노트" className={group}>
      {notes.map((note) => (
        <Held key={note.id} note={note} timeZone={timeZone} />
      ))}
    </ul>
  );
}
