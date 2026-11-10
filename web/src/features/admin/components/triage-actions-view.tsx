import Link from "next/link";

import { Chip } from "@/design/chip";
import { Section } from "@/design/section";

import { formatTime } from "../format";
import { labelOf, triageActionLabels, triageCategoryLabels } from "../labels";
import type { TriageAction, TriageAppeal } from "../read-triage";
import { Empty, group, row } from "./admin-section";
import { TriageAppealActions } from "./triage-appeal-actions";
import { TriageRecheckActions } from "./triage-recheck-actions";
import { TriageUndoAction } from "./triage-undo-action";
import { Passage, percent } from "./triage-verdict";

const noteLink =
  "inline-flex min-h-tap-target items-center text-body-strong break-words underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** What the AI did to a note, with its reason and the model that judged it. */
function Done({ action, timeZone }: { action: TriageAction; timeZone: string }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/decks/${action.deckId}`} className={noteLink}>
          {action.name}
        </Link>
        <Chip tone="amber">{labelOf(triageActionLabels, action.action)}</Chip>
        {action.undoneAt !== null && <Chip>되돌림</Chip>}
        {action.recheckedAt !== null && (
          <Chip>{action.recheckAgreed === true ? "다시 확인: 맞아요" : "다시 확인: 아니에요"}</Chip>
        )}
      </div>
      <p className="text-body">
        {labelOf(triageCategoryLabels, action.category)} · 확신 {percent(action.confidence)}
      </p>
      {action.reason !== "" && <p className="text-body break-words">{action.reason}</p>}
      <p className="text-caption text-ink-2">
        {action.model} · {formatTime(action.createdAt, timeZone)}
      </p>
    </>
  );
}

/**
 * 신고를 판단하는 AI가 한 일: everything it did in the last 30 days, each with its reason and
 * model and 되돌리기 asked first; the sample of them waiting for a second look; and the owners'
 * appeals waiting for a decision (ADR 0244).
 */
export function TriageActionsView({
  actions,
  sample,
  appeals,
  timeZone,
}: {
  actions: TriageAction[];
  sample: TriageAction[];
  appeals: TriageAppeal[];
  timeZone: string;
}) {
  return (
    <div className="flex flex-col gap-section-gap">
      <Section
        label="AI가 처리한 것"
        note="최근 30일 동안 AI가 숨기거나 신고를 정리한 노트예요. 되돌리면 AI가 하기 전으로 돌아가요."
      >
        {actions.length === 0 ? (
          <Empty>AI가 처리한 것이 없어요. AI가 판단만 하는 동안에는 여기에 쌓이지 않아요.</Empty>
        ) : (
          <ul aria-label="AI가 처리한 것" className={group}>
            {actions.map((action) => (
              <li key={action.actionId} className={`${row} gap-2`}>
                <Done action={action} timeZone={timeZone} />
                {action.undoneAt === null && (
                  <TriageUndoAction
                    actionId={action.actionId}
                    name={action.name}
                    action={action.action}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section
        label="다시 확인할 것"
        note="처리한 것 가운데 무작위로 뽑은 표본이에요. 다시 보고 AI가 맞았는지 남겨 주세요."
      >
        {sample.length === 0 ? (
          <Empty>다시 확인할 것이 없어요.</Empty>
        ) : (
          <ul aria-label="다시 확인할 것" className={group}>
            {sample.map((action) => (
              <li key={action.actionId} className={`${row} gap-2`}>
                <Done action={action} timeZone={timeZone} />
                <TriageRecheckActions actionId={action.actionId} name={action.name} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section
        label="이의 신청"
        note="AI가 숨긴 노트의 주인이 이의를 낸 것이에요. 되돌리거나 그대로 두고 결과를 남겨 주세요."
      >
        {appeals.length === 0 ? (
          <Empty>처리할 이의 신청이 없어요.</Empty>
        ) : (
          <ul aria-label="이의 신청" className={group}>
            {appeals.map((appeal) => (
              <li key={appeal.actionId} className={`${row} gap-2`}>
                <Link href={`/decks/${appeal.deckId}`} className={noteLink}>
                  {appeal.name}
                </Link>
                <p className="text-body">
                  {labelOf(triageCategoryLabels, appeal.category)} · 확신{" "}
                  {percent(appeal.confidence)}
                </p>
                <Passage passage={appeal.passage} where={appeal.field} />
                <p className="text-caption text-ink-2">{formatTime(appeal.appealedAt, timeZone)}</p>
                <TriageAppealActions deckId={appeal.deckId} name={appeal.name} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
