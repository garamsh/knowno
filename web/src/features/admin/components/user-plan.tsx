import { studyDayStart } from "@/features/study";

import { revokePlan } from "../revoke-plan";
import { formatDate, formatTime } from "../format";
import { labelOf, planLabels, providerLabels, termsLabel } from "../labels";
import type { UserPlan as Plan } from "../read-admin";
import { Section } from "@/design/section";
import { button, group } from "./admin-section";
import { ConfirmAction } from "./confirm-action";
import { GrantPlanForm } from "./grant-plan-form";

/**
 * A user's plan now, the grant behind it and the next renewal, with 요금제 바꾸기 opening the form
 * to grant another and the way back to Free.
 */
export function UserPlan({
  userId,
  email,
  plan,
  timeZone,
  renewal,
}: {
  userId: string;
  email: string;
  plan: Plan;
  timeZone: string;
  /** The next renewal, as "2026-12-01". */
  renewal: string;
}) {
  const grant = plan.grant;
  const entitlement = plan.entitlement;
  const facts: (readonly [string, string])[] = [
    [
      "지금",
      entitlement === null
        ? "요금제 버전이 없어요"
        : `${planLabels[entitlement.plan] ?? entitlement.plan} · ${termsLabel(entitlement.quota, entitlement.amount)}`,
    ],
    ...(entitlement === null || entitlement.serving === null
      ? []
      : [
          [
            "모델",
            `${labelOf(providerLabels, entitlement.serving.provider)} · ${entitlement.serving.model}`,
          ] as const,
        ]),
    ...(grant === null
      ? []
      : [
          [
            `${planLabels[grant.plan] ?? grant.plan} 지정`,
            `${formatTime(grant.grantedAt, timeZone)}${grant.grantedByEmail === null ? "" : ` · ${grant.grantedByEmail}`}`,
          ] as const,
          ...(grant.endsAt === null
            ? []
            : [
                [
                  grant.ended ? "끝난 날" : "마지막 날",
                  formatDate(studyDayStart(grant.endsAt - 1, timeZone), timeZone),
                ] as const,
              ]),
        ]),
    ["다음 갱신", renewal],
  ];
  return (
    <Section label="요금제">
      <dl className={group}>
        {facts.map(([term, value]) => (
          <div key={term} className="flex items-baseline justify-between gap-3 px-4 py-3">
            <dt className="shrink-0 text-body text-ink-2">{term}</dt>
            <dd className="text-right text-body-strong break-all tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <details className="flex flex-col gap-2">
        <summary
          className={`${button.row} mt-2 w-fit list-none [&::-webkit-details-marker]:hidden`}
        >
          요금제 바꾸기
        </summary>
        <GrantPlanForm userId={userId} />
        {grant !== null && (
          <ConfirmAction
            compact
            label="무료로 되돌리기"
            question={`${email}의 요금제를 무료로 되돌릴까요?`}
            confirmLabel="무료로 되돌리기"
            action={revokePlan.bind(null, userId)}
          />
        )}
      </details>
    </Section>
  );
}
