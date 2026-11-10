import type { ReactNode } from "react";

import { studyDayStart } from "@/features/study";

import { formatDate, formatTime } from "../format";
import { labelOf, planLabels, providerLabels, termsLabel } from "../labels";
import type { UserPlan as Plan } from "../read-admin";
import { Section } from "@/design/section";
import { type Fact, Facts } from "./admin-section";

/**
 * A user's plan now, the provider serving it with its model under it, the admin's grant behind it
 * (a store grant is not in this read; the log shows it) and the next renewal, ended by [children], the rows that change it (`user-view.tsx`).
 */
export function UserPlan({
  plan,
  timeZone,
  renewal,
  children,
}: {
  plan: Plan;
  timeZone: string;
  /** The next renewal, as "2026-12-01". */
  renewal: string;
  children?: ReactNode;
}) {
  const grant = plan.grant;
  const entitlement = plan.entitlement;
  const facts: Fact[] = [
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
            labelOf(providerLabels, entitlement.serving.provider),
            entitlement.serving.model,
          ] as const,
        ]),
    ...(grant === null
      ? []
      : [
          [
            `${planLabels[grant.plan] ?? grant.plan} 지정`,
            `${formatTime(grant.grantedAt, timeZone)}${grant.grantedByEmail === null ? "" : ` · ${grant.grantedByEmail}`}`,
          ] as const,
          ["지정한 곳", "관리자"] as const,
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
      <Facts facts={facts}>{children}</Facts>
    </Section>
  );
}
