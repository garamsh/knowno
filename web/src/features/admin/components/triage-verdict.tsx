import { Chip } from "@/design/chip";

import { labelOf, placeLabels, triageCategoryLabels } from "../labels";
import type { TriageNote } from "../read-triage";

/** [confidence], 0 to 1, as a whole percent: "92%". */
export function percent(confidence: number): string {
  return `${String(Math.round(confidence * 100))}%`;
}

/** Where a verdict's passage is in the note, in words: the server's `field` names `name`, `description`, `front` or `back`, with a path after a colon that is not shown. */
export function placeOf(where: string | null): string | null {
  if (where === null) return null;
  const place = where.split(":")[0] ?? "";
  return placeLabels[place] ?? null;
}

/** The words an AI quoted, marked as the screening queue marks a finding, under the place it names. */
export function Passage({ passage, where }: { passage: string | null; where: string | null }) {
  if (passage === null) return null;
  const place = placeOf(where);
  return (
    <span className="flex flex-col gap-1">
      {place !== null && <span className="text-caption text-ink-2">{place}</span>}
      <span className="text-body break-words whitespace-pre-wrap">
        <mark className="rounded-sm bg-tint-amber px-0.5 text-ink">{passage}</mark>
      </span>
    </span>
  );
}

/**
 * What the AI made of a reported note: its category and how sure it was, the passage it quoted
 * marked in the field it names, and the model; or, while there is no verdict, that there is none.
 * An AI action standing on the note and an appeal of it are chips.
 */
export function TriageVerdict({ note }: { note: TriageNote }) {
  const { verdict } = note;
  return (
    <span className="flex flex-col gap-1 border-l-2 border-outline pl-3">
      {verdict === null ? (
        <span className="text-caption text-ink-2">
          {note.failures > 0
            ? `AI가 판단하지 못했어요 (${String(note.failures)}번 실패). 사람이 확인해 주세요.`
            : "AI가 아직 판단하지 않았어요."}
        </span>
      ) : (
        <>
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-body-strong">
              AI 판단: {labelOf(triageCategoryLabels, verdict.category)}
            </span>
            <span className="text-caption text-ink-2">확신 {percent(verdict.confidence)}</span>
            <span className="text-caption text-muted">{verdict.model}</span>
          </span>
          <Passage passage={verdict.passage} where={verdict.field} />
        </>
      )}
      {note.actionId !== null && <Chip tone="amber">AI가 처리함</Chip>}
      {note.appealed && <Chip tone="amber">이의 신청</Chip>}
    </span>
  );
}
