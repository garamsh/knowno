import Link from "next/link";

import { Chip } from "@/design/chip";
import { Section } from "@/design/section";

import { formatDate, formatTime } from "../format";
import { planLabels, termsLabel } from "../labels";
import type { AdminUser } from "../read-admin";
import { button, Facts } from "./admin-section";
import { UserDecks } from "./user-decks";
import { UserPlan } from "./user-plan";
import { UserSuspension } from "./user-suspension";

/**
 * Everything about one user: the account's facts, the plan with its renewal and the way to change
 * it, every note, and the suspension. On its own page it is the page; as the users' side [panel]
 * it is one column under a heading, with the way to the page and back to the list (ADR 0181).
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
          <Heading className="text-deck-name break-all">{user.email}</Heading>
          {user.plan.entitlement !== null && (
            <Chip tone="brand">{planLabels[user.plan.entitlement.plan]}</Chip>
          )}
          {user.admin && <Chip tone="brand">관리자</Chip>}
          {user.suspension !== null && <Chip tone="amber">정지됨</Chip>}
        </div>
        {panel !== undefined && (
          <div className="flex flex-wrap gap-2 pb-2">
            <Link href={panel.close} className={button.row}>
              목록으로
            </Link>
            <Link href={`/users/${user.id}`} className={button.row}>
              전체 화면으로
            </Link>
          </div>
        )}
      </header>
      <div
        className={`grid items-start gap-section-gap ${panel === undefined ? "lg:grid-cols-2 lg:gap-4" : ""}`}
      >
        <Section label="계정">
          <Facts facts={facts} />
        </Section>
        <UserPlan
          userId={user.id}
          email={user.email}
          plan={user.plan}
          timeZone={timeZone}
          renewal={user.renewal}
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
