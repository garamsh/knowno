import Link from "next/link";

import { Chip } from "@/design/chip";
import { Section } from "@/design/section";

import { formatDate, formatTime } from "../format";
import { planLabels, termsLabel } from "../labels";
import { revokePlan } from "../revoke-plan";
import type { AdminUser } from "../read-admin";
import { button, Email, Facts } from "./admin-section";
import { ConfirmAction } from "./confirm-action";
import { GrantPlanForm } from "./grant-plan-form";
import { SheetButton } from "./sheet-button";
import { UserDecks } from "./user-decks";
import { UserPlan } from "./user-plan";
import { SuspensionAction, SuspensionState } from "./user-suspension";

/**
 * Everything about one user: the account's facts, the plan with its renewal, the user's actions in
 * one row of buttons of one size, 요금제 바꾸기, whose form opens in the shared sheet, 무료로
 * 되돌리기 while a grant stands, and 이용 정지 or 정지 해제, then every note. On its own page it is the
 * page; as the users' side [panel] it is one column under a heading, with the way to the page and
 * back to the list (ADR 0181).
 */
export function UserView({
  user,
  timeZone,
  panel,
}: {
  user: AdminUser;
  timeZone: string;
  /** Where "목록으로" leads, when the view sits beside the list. */
  panel?: { close: string };
}) {
  const facts: (readonly [string, string])[] = [
    ["가입일", formatDate(user.createdAt, timeZone)],
    [
      "마지막 학습",
      user.lastAnswerAt === null ? "없어요" : formatTime(user.lastAnswerAt, timeZone),
    ],
    [
      "노트 · 카드",
      `${user.decks.toLocaleString("ko-KR")}개 · ${user.cards.toLocaleString("ko-KR")}장`,
    ],
    ...(user.plan.entitlement === null
      ? []
      : [
          [
            user.plan.entitlement.quota === "monthly" ? "이번 달 사진 추출" : "오늘 사진 추출",
            `${String(user.plan.entitlement.used)}장 / ${termsLabel(user.plan.entitlement.quota, user.plan.entitlement.amount)}`,
          ] as const,
        ]),
  ];
  const Heading = panel === undefined ? "h1" : "h2";
  return (
    <div className="flex flex-col gap-section-gap">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Heading className="min-w-0 text-deck-name break-words">
            <Email email={user.email} />
          </Heading>
          {user.plan.entitlement !== null && (
            <Chip tone="brand">{planLabels[user.plan.entitlement.plan]}</Chip>
          )}
          {user.admin && <Chip tone="brand">관리자</Chip>}
          {user.suspension !== null && <Chip tone="amber">정지됨</Chip>}
        </div>
        {panel !== undefined && (
          <nav aria-label="사용자 보기" className="flex flex-wrap gap-2">
            <Link href={panel.close} className={button.row}>
              목록으로
            </Link>
            <Link href={`/users/${user.id}`} className={button.row}>
              전체 화면으로
            </Link>
          </nav>
        )}
      </header>
      <div
        className={`grid items-start gap-section-gap ${panel === undefined ? "lg:grid-cols-2 lg:gap-4" : ""}`}
      >
        <Section label="계정">
          <Facts facts={facts} />
        </Section>
        <UserPlan plan={user.plan} timeZone={timeZone} renewal={user.renewal} />
      </div>
      <Section
        label="작업"
        note={
          user.suspension === null
            ? "이용 정지하면 로그인, 사진으로 카드 만들기, 동기화가 막혀요. 데이터는 그대로 남아요."
            : undefined
        }
      >
        {user.suspension !== null && (
          <SuspensionState suspension={user.suspension} timeZone={timeZone} />
        )}
        {/* A question opened in place takes a line of its own. */}
        <div className="flex flex-wrap items-start gap-2 [&>*:has([role=group])]:basis-full">
          <SheetButton label="요금제 바꾸기" title="요금제 바꾸기" description={user.email}>
            <GrantPlanForm userId={user.id} />
          </SheetButton>
          {user.plan.grant !== null && (
            <ConfirmAction
              compact
              label="무료로 되돌리기"
              question={`${user.email}의 요금제를 무료로 되돌릴까요?`}
              confirmLabel="무료로 되돌리기"
              action={revokePlan.bind(null, user.id)}
            />
          )}
          <SuspensionAction
            userId={user.id}
            email={user.email}
            suspended={user.suspension !== null}
          />
        </div>
      </Section>
      <UserDecks decks={user.allDecks} />
    </div>
  );
}
