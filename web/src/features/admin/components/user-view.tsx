import { X } from "lucide-react";
import Link from "next/link";

import { Chip } from "@/design/chip";
import { Section } from "@/design/section";

import { formatDate, formatTime } from "../format";
import { planLabels, termsLabel } from "../labels";
import { revokePlan } from "../revoke-plan";
import type { AdminUser } from "../read-admin";
import { Email, type Fact, Facts } from "./admin-section";
import { GrantPlanForm } from "./grant-plan-form";
import { SheetButton } from "./sheet-button";
import { SheetConfirm } from "./sheet-confirm";
import { UserDecks } from "./user-decks";
import { UserPlan } from "./user-plan";
import { SuspensionSection } from "./user-suspension";

/** The quiet icon link of the panel's header, a tap target, named for assistive technology. */
const iconLink =
  "pressable flex size-tap-target shrink-0 items-center justify-center rounded-button text-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/**
 * Everything about one user: its email over its plan and sign-up day, the account's facts, the
 * plan ended by its rows, 요금제 바꾸기, whose form opens in the shared sheet, and 무료로 되돌리기
 * while a grant stands, every note, and last the suspension. On its own page it is the page; as
 * the users' side [panel] it is one column whose header holds 닫기 as a quiet icon
 * (ADR 0181). Nothing in it is a raised button but a sheet's own primary.
 */
export function UserView({
  user,
  timeZone,
  panel,
}: {
  user: AdminUser;
  timeZone: string;
  /** Where 닫기 leads, when the view sits beside the list. */
  panel?: { close: string };
}) {
  const facts: Fact[] = [
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
      <header className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Heading className="text-body-strong break-words">
            <Email email={user.email} />
          </Heading>
          <div className="flex flex-wrap items-center gap-2">
            {user.plan.entitlement !== null && (
              <Chip tone="brand">{planLabels[user.plan.entitlement.plan]}</Chip>
            )}
            {user.admin && <Chip tone="brand">관리자</Chip>}
            {user.suspension !== null && <Chip tone="amber">정지됨</Chip>}
            <span className="text-secondary text-muted tabular-nums">
              가입 {formatDate(user.createdAt, timeZone)}
            </span>
          </div>
        </div>
        {panel !== undefined && (
          <nav aria-label="사용자 보기" className="flex shrink-0">
            <Link href={panel.close} aria-label="닫기" className={iconLink}>
              <X aria-hidden className="size-5" />
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
        <UserPlan plan={user.plan} timeZone={timeZone} renewal={user.renewal}>
          <SheetButton row label="요금제 바꾸기" title="요금제 바꾸기" description={user.email}>
            <GrantPlanForm userId={user.id} />
          </SheetButton>
          {user.plan.grant !== null && (
            <SheetConfirm
              look="row"
              label="무료로 되돌리기"
              question={`${user.email}의 요금제를 무료로 되돌릴까요?`}
              consequence="지정한 요금제를 끝내고 바로 무료로 돌아가요."
              confirmLabel="무료로 되돌리기"
              action={revokePlan.bind(null, user.id)}
            />
          )}
        </UserPlan>
      </div>
      <UserDecks decks={user.allDecks} />
      <SuspensionSection
        userId={user.id}
        email={user.email}
        suspension={user.suspension}
        timeZone={timeZone}
      />
    </div>
  );
}
