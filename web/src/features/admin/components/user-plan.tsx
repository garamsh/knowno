import { studyDayStart } from "@/features/study";

import { formatDate, formatTime } from "../format";
import { labelOf, planLabels, providerLabels, termsLabel } from "../labels";
import type { UserPlan as Plan } from "../read-admin";
import { Section } from "@/design/section";
import { Facts } from "./admin-section";

/**
 * A user's plan now, the model serving it, the grant behind it and the next renewal. The way to
 * change it is among the user's actions (`user-view.tsx`).
 */
export function UserPlan({
  plan,
  timeZone,
  renewal,
}: {
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
      <Facts facts={facts} />
    </Section>
  );
}
