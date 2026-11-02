import Link from "next/link";

import { formatTime } from "../format";
import { planLabels, termsLabel } from "../labels";
import type { PlanId, PlanVersion } from "../read-admin";
import { AdminSection, group, row } from "./admin-section";
import { PlanForm } from "./plan-form";

const plans: PlanId[] = ["free", "pro", "max"];

/**
 * Each plan's version a user subscribing now takes, the form for a new version, and every version,
 * the latest start first. A plan's provider and model are 설정 → AI 제공자's (ADR 0162).
 */
export function PlansView({ versions, timeZone }: { versions: PlanVersion[]; timeZone: string }) {
  return (
    <div className="flex flex-col gap-section-gap">
      <div className="grid items-start gap-section-gap lg:grid-cols-3 lg:gap-4">
        {plans.map((plan) => {
          const name = planLabels[plan] ?? plan;
          const own = versions.filter((version) => version.plan === plan);
          const current = own.find((version) => version.current) ?? null;
          // The form starts from the current terms, or the latest version's while none is current.
          const start = current ?? own[0] ?? null;
          return (
            <AdminSection key={plan} label={name}>
              <div className={group}>
                <div className={row}>
                  <p className="text-body-strong">
                    {current === null
                      ? "지금 가입하면 받을 버전이 없어요"
                      : `지금 가입하면 ${termsLabel(current.quota, current.amount)}`}
                  </p>
                </div>
              </div>
              <PlanForm
                plan={plan}
                name={name}
                quota={start?.quota ?? "daily"}
                amount={start?.amount ?? 0}
              />
              <h3 className="mt-3 px-1 text-section text-muted">버전</h3>
              <ul aria-label={`${name} 버전`} className={group}>
                {own.map((version) => (
                  <li key={version.id} className={row}>
                    <span className="text-body break-all">
                      {termsLabel(version.quota, version.amount)}
                      {version.current ? " · 지금 가입 시 적용" : ""}
                    </span>
                    <span className="text-caption text-muted">
                      {formatTime(version.startsAt, timeZone)}부터
                      {version.appliesToAll
                        ? " · 기존 사용자도 적용"
                        : " · 기존 사용자는 갱신일부터"}
                      {version.createdByEmail === null ? "" : ` · ${version.createdByEmail}`}
                    </span>
                  </li>
                ))}
              </ul>
            </AdminSection>
          );
        })}
      </div>
      <p className="px-1 text-caption text-muted">
        요금제마다 사진을 읽는 AI 제공자와 모델은{" "}
        <Link
          href="/admin/settings/ai"
          className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
        >
          AI 제공자
        </Link>
        에서 정해요.
      </p>
    </div>
  );
}
