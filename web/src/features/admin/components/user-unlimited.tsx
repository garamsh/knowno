import { studyDayStart } from "@/features/study";

import { formatDate, formatTime } from "../format";
import type { UserUnlimited as Unlimited } from "../read-admin";
import { revokeUnlimited } from "../revoke-unlimited";
import { AdminSection, button, group } from "./admin-section";
import { ConfirmAction } from "./confirm-action";
import { GrantUnlimitedForm } from "./grant-unlimited-form";

/**
 * Whether no photo limit applies to a user, as the server decides it (ADR 0157), the 무제한 grant
 * behind it with its end, and the way to grant or revoke one.
 */
export function UserUnlimited({
  userId,
  email,
  admin,
  unlimited,
  timeZone,
}: {
  userId: string;
  email: string;
  admin: boolean;
  unlimited: Unlimited;
  timeZone: string;
}) {
  const grant = unlimited.grant;
  const facts: (readonly [string, string])[] = [
    ["지금", unlimited.unlimited ? (admin ? "무제한 · 관리자" : "무제한") : "요금제 한도대로"],
    ...(grant === null
      ? []
      : [
          [
            "무제한 지정",
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
  ];
  return (
    <AdminSection
      label="무제한"
      note="사진 한도 없이 써요. 판매하지 않고, 관리자는 지정 없이 무제한이에요."
    >
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
          무제한 바꾸기
        </summary>
        <GrantUnlimitedForm userId={userId} />
        {grant !== null && (
          <ConfirmAction
            compact
            label="무제한 해제"
            question={`${email}의 무제한을 해제할까요?`}
            confirmLabel="무제한 해제"
            action={revokeUnlimited.bind(null, userId)}
          />
        )}
      </details>
    </AdminSection>
  );
}
