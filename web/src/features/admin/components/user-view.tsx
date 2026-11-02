import { Chip } from "@/design/chip";

import { formatDate, formatTime } from "../format";
import { planLabels, termsLabel } from "../labels";
import type { AdminUser } from "../read-admin";
import { AdminSection, group } from "./admin-section";
import { UserDecks } from "./user-decks";
import { UserPlan } from "./user-plan";
import { UserSuspension } from "./user-suspension";
import { UserUnlimited } from "./user-unlimited";

/**
 * Everything about one user on one page: the account's facts, the plan with its renewal and the way
 * to change it, 무제한, every note, and the suspension.
 */
export function UserView({ user, timeZone }: { user: AdminUser; timeZone: string }) {
  const facts = [
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
            `${String(user.plan.entitlement.used)}장 / ${user.unlimited.unlimited ? "무제한" : termsLabel(user.plan.entitlement.quota, user.plan.entitlement.amount)}`,
          ] as const,
        ]),
  ] as const;
  return (
    <div className="flex flex-col gap-section-gap">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-deck-name break-all">{user.email}</h1>
        {user.plan.entitlement !== null && (
          <Chip tone="brand">{planLabels[user.plan.entitlement.plan]}</Chip>
        )}
        {user.unlimited.unlimited && <Chip tone="brand">무제한</Chip>}
        {user.admin && <Chip tone="brand">관리자</Chip>}
        {user.suspension !== null && <Chip tone="amber">정지됨</Chip>}
      </header>
      <div className="grid items-start gap-section-gap lg:grid-cols-2 lg:gap-4">
        <AdminSection label="계정">
          <dl className={group}>
            {facts.map(([term, value]) => (
              <div key={term} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <dt className="text-body text-ink-2">{term}</dt>
                <dd className="text-right text-body-strong tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </AdminSection>
        <UserPlan
          userId={user.id}
          email={user.email}
          plan={user.plan}
          timeZone={timeZone}
          renewal={user.renewal}
        />
        <UserUnlimited
          userId={user.id}
          email={user.email}
          admin={user.admin}
          unlimited={user.unlimited}
          timeZone={timeZone}
        />
      </div>
      <UserDecks decks={user.allDecks} />
      <UserSuspension
        userId={user.id}
        email={user.email}
        suspension={user.suspension}
        timeZone={timeZone}
      />
    </div>
  );
}
