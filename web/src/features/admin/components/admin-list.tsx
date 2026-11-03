import { revokeAdmin } from "../revoke-admin";
import { formatDate } from "../format";
import type { AdminMember } from "../read-admin";
import { Section } from "@/design/section";
import { group } from "./admin-section";
import { ConfirmAction } from "./confirm-action";

/** The admins, each with who granted the role and when, and a revoke for every one but oneself. */
export function AdminList({ admins, timeZone }: { admins: AdminMember[]; timeZone: string }) {
  return (
    <Section label="지정된 관리자">
      <ul className={group}>
        {admins.map((admin) => (
          <li
            key={admin.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-body-strong">
                {admin.email}
                {admin.self ? " (나)" : ""}
              </span>
              <span className="text-caption text-muted">
                {formatDate(admin.grantedAt, timeZone)} 지정
                {admin.grantedByEmail === null ? "" : ` · ${admin.grantedByEmail}`}
              </span>
            </span>
            {!admin.self && (
              <ConfirmAction
                label="해제"
                question={`${admin.email}의 관리자 권한을 해제할까요?`}
                confirmLabel="해제"
                action={revokeAdmin.bind(null, admin.id)}
              />
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
