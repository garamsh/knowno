import Link from "next/link";

import { Section } from "@/design/section";

import { formatTime } from "../format";
import { labelOf, planLabels, providerLabels, termsLabel } from "../labels";
import type { AiConfiguration, PlanId, PlanVersion } from "../read-admin";
import { group, row } from "./admin-section";
import { AdminTable, CellLabel, cellClass, rowClass } from "./admin-table";
import { PlanForm } from "./plan-form";
import { SheetButton } from "./sheet-button";

const plans: PlanId[] = ["free", "pro", "max", "special"];

const head = [
  { label: "요금제" },
  { label: "사진 한도" },
  { label: "AI 구성" },
  { label: "가입자", align: "end" },
  { label: "작업" },
] as const;

/**
 * 요금제 (ADR 0181): a table of the plans, 스페셜 listed like the others with no hidden badge (ADR
 * 0177), each with the terms a user subscribing now takes, the AI configuration that serves it,
 * shown and linked to AI, where it is changed, and the users on it. A plan's "한도 바꾸기" opens,
 * in the shared sheet, every version, the latest start first, and the form for a new one, so the
 * page shows nothing else open. 스페셜's terms are always 제한 없음, so it has no form.
 */
export function PlansView({
  versions,
  configurations,
  members,
  timeZone,
}: {
  versions: PlanVersion[];
  configurations: AiConfiguration[];
  /** The users on each plan now, or null where that count could not be read. */
  members: Record<PlanId, number | null>;
  timeZone: string;
}) {
  const shown = plans.map((plan) => {
    const own = versions.filter((version) => version.plan === plan);
    const current = own.find((version) => version.current) ?? null;
    const active = configurations.find((c) => c.plan === plan && c.label === "active") ?? null;
    return { plan, name: planLabels[plan] ?? plan, own, current, active, count: members[plan] };
  });
  return (
    <AdminTable label="요금제 목록" head={head}>
      {shown.map(({ plan, name, own, current, active, count }) => {
        // The form starts from the current terms, or the latest version's while none is current.
        const start = current ?? own[0] ?? null;
        return (
          <tr key={plan} className={rowClass()}>
            <td className={`${cellClass({ lead: true })} text-body-strong`}>{name}</td>
            <td className={cellClass()}>
              <CellLabel>사진 한도</CellLabel>
              {current === null ? "버전 없음" : termsLabel(current.quota, current.amount)}
            </td>
            <td className={`${cellClass()} break-words`}>
              <CellLabel>AI 구성</CellLabel>
              {active === null
                ? "구성 없음"
                : `${labelOf(providerLabels, active.provider)} · ${active.model}`}{" "}
              <Link
                href="/settings/ai"
                className="text-label whitespace-nowrap text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ink"
              >
                AI에서 보기
              </Link>
            </td>
            <td className={cellClass({ align: "end" })}>
              <CellLabel>가입자</CellLabel>
              {count === null ? "읽지 못함" : `${count.toLocaleString("ko-KR")}명`}
            </td>
            <td className={`${cellClass({ lead: true })} max-lg:pt-1`}>
              {plan !== "special" && start?.quota !== "none" && (
                <div className="pb-2 lg:py-1">
                  <SheetButton label="한도 바꾸기" title={`${name} 한도 바꾸기`}>
                    <div className="flex flex-col gap-section-gap pt-2">
                      <Section label="버전">
                        <ul aria-label={`${name} 버전`} className={group}>
                          {own.map((version) => (
                            <li key={version.id} className={row}>
                              <span className="text-body break-words">
                                {termsLabel(version.quota, version.amount)}
                                {version.current ? " · 지금 가입 시 적용" : ""}
                              </span>
                              <span className="text-caption text-muted">
                                {formatTime(version.startsAt, timeZone)}부터
                                {version.appliesToAll
                                  ? " · 기존 사용자도 적용"
                                  : " · 기존 사용자는 갱신일부터"}
                                {version.createdByEmail === null
                                  ? ""
                                  : ` · ${version.createdByEmail}`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </Section>
                      <PlanForm
                        plan={plan}
                        name={name}
                        quota={start?.quota ?? "daily"}
                        amount={start?.amount ?? 0}
                      />
                    </div>
                  </SheetButton>
                </div>
              )}
            </td>
          </tr>
        );
      })}
    </AdminTable>
  );
}
