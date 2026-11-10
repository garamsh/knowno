import { Section } from "@/design/section";

import type { MyPlan as Plan } from "../read-my-plan";

const names = { free: "무료", pro: "플러스", max: "프로" } as const;

/** [time] as a date in [timeZone], as "2026년 12월 1일". */
function dateOf(time: number, timeZone: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(time);
}

/**
 * "내 플랜", the app's card read-only: the plan, the photos used and the limit, and a store plan's
 * end or renewal. The web sells nothing, so it only says where a plan is bought: 플러스 in the
 * knowno app on 무료, a store plan where it was bought (for now the App Store). An admin or a
 * 무제한 user, or a plan an admin gave, is told nothing to buy.
 */
export function MyPlan({ plan, timeZone }: { plan: Plan; timeZone: string }) {
  const store = plan.source === "store";
  return (
    <Section label="내 플랜">
      <div className="flex flex-col divide-y divide-hairline rounded-group bg-surface">
        <p className="flex min-h-button items-center px-4 py-3 text-body-strong">
          {names[plan.plan]}
        </p>
        <p className="flex min-h-button items-center px-4 py-3 text-body">
          {plan.photoLimit === null
            ? "제한 없이 쓸 수 있어요"
            : `사진 ${String(plan.used)}/${String(plan.photoLimit)}장 사용`}
        </p>
        {store && plan.endsAt !== null && (
          <p className="flex min-h-button items-center px-4 py-3 text-body">
            {plan.renews
              ? `다음 갱신 ${dateOf(plan.endsAt, timeZone)}`
              : `${dateOf(plan.endsAt, timeZone)}까지 쓸 수 있어요`}
          </p>
        )}
      </div>
      {plan.source === "none" && plan.plan === "free" && (
        <p className="px-1 text-caption break-keep text-muted">
          플러스는 knowno 앱의 내 플랜에서 시작할 수 있어요.
        </p>
      )}
      {store && (
        <p className="px-1 text-caption break-keep text-muted">
          구독은 구매한 곳에서 관리해요. 지금은 App Store예요.
        </p>
      )}
    </Section>
  );
}
