import { Chip } from "@/design/chip";

import { formatDate, formatTime } from "../format";
import { termsLabel } from "../labels";
import type { AdminUser } from "../read-admin";
import { AdminSection, group } from "./admin-section";
import { PublicDecks } from "./public-decks";
import { UserDecks } from "./user-decks";
import { UserPlan } from "./user-plan";
import { UserSuspension } from "./user-suspension";

/** One user, read-only: sign-up, last study, decks and cards, public decks and the period's photos. */
export function UserView({ user, timeZone }: { user: AdminUser; timeZone: string }) {
  const facts = [
    ["가입일", formatDate(user.createdAt, timeZone)],
    [
      "마지막 학습",
      user.lastAnswerAt === null ? "없어요" : formatTime(user.lastAnswerAt, timeZone),
    ],
    ["노트", `${String(user.decks)}개`],
    ["카드", `${String(user.cards)}장`],
    ...(user.plan.entitlement === null
      ? []
      : [
          [
            user.plan.entitlement.quota === "monthly" ? "이번 달 사진 추출" : "오늘 사진 추출",
            `${String(user.plan.entitlement.used)}장 / ${termsLabel(user.plan.entitlement.quota, user.plan.entitlement.amount)}`,
          ] as const,
        ]),
  ] as const;
  return (
    <div className="flex flex-col gap-section-gap">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-deck-name break-all">{user.email}</h1>
        {user.admin && <Chip tone="brand">관리자</Chip>}
        {user.suspension !== null && <Chip tone="amber">정지됨</Chip>}
      </header>
      <dl className={group}>
        {facts.map(([term, value]) => (
          <div key={term} className="flex items-baseline justify-between gap-3 px-4 py-3">
            <dt className="text-body text-ink-2">{term}</dt>
            <dd className="text-right text-body-strong tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <UserPlan userId={user.id} email={user.email} plan={user.plan} timeZone={timeZone} />
      <UserDecks decks={user.allDecks} />
      <AdminSection label="공개 노트">
        <PublicDecks
          decks={user.publicDecks}
          timeZone={timeZone}
          empty="공개한 노트가 없어요. 이 사용자가 노트를 공개하면 여기에 보여요."
        />
      </AdminSection>
      <UserSuspension
        userId={user.id}
        email={user.email}
        suspension={user.suspension}
        timeZone={timeZone}
      />
    </div>
  );
}
