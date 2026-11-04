import Link from "next/link";

import { Chip } from "@/design/chip";

import { usd } from "../format";
import { planLabels } from "../labels";
import { failureAlarm, failureRate, type OutcomeCounts, percent } from "../outcomes";
import type { OpenReports, PlanId, WeekActivity, WeekPair } from "../read-admin";
import type { WeekUsage } from "../usage";
import { Section } from "@/design/section";
import { button, card, group } from "./admin-section";

/** An age in whole days: "오늘" or "n일 전". */
function ago(days: number): string {
  return days <= 0 ? "오늘" : `${String(days)}일 전`;
}

/** [current] against [previous] as a signed whole percent, or null when there is no base. */
function change({ current, previous }: WeekPair): string | null {
  if (previous === 0) return null;
  const value = Math.round(((current - previous) / previous) * 100);
  return value > 0 ? `+${String(value)}%` : value < 0 ? `−${String(-value)}%` : "0%";
}

/** A number of people, a day's average to one decimal. */
function people(value: number): string {
  return `${Number.isInteger(value) ? value.toLocaleString("ko-KR") : value.toFixed(1)}명`;
}

/** One card: what it counts, its figure, a line under it, and its one action. */
function TodoCard({
  label,
  figure,
  alarm = false,
  line,
  action,
}: {
  label: string;
  figure: string;
  alarm?: boolean;
  line: string;
  action: { href: string; label: string };
}) {
  return (
    <section aria-label={label} className={card}>
      <h2 className="text-body-strong text-ink-2">{label}</h2>
      <p className={`text-figure tabular-nums ${alarm ? "text-dont-know-text" : "text-ink"}`}>
        {figure}
      </p>
      <p className="text-caption text-ink-2">{line}</p>
      <Link href={action.href} className={`${button.row} mt-2 self-start`}>
        {action.label}
      </Link>
    </section>
  );
}

/** A row of 이번 주: what it counts, last week's figure under it, this week's and the change. */
function WeekRow({
  term,
  previous,
  current,
  delta,
}: {
  term: string;
  previous: string;
  current: string;
  delta: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <dt className="flex flex-col">
        <span className="text-body-strong">{term}</span>
        <span className="text-caption text-ink-2">{previous}</span>
      </dt>
      <dd className="flex items-center gap-2 text-right text-body-strong tabular-nums">
        {current}
        {delta !== null && <Chip>{delta}</Chip>}
      </dd>
    </div>
  );
}

/**
 * 처리할 일: a card for each thing waiting on an operator, each with one action, then the last 7
 * days against the 7 before. A queue the area adds later takes a card of its own here.
 */
export function TodoView({
  reports,
  failures,
  drafts,
  week,
  usage,
}: {
  reports: OpenReports;
  /** The last 7 UTC days' recorded extractions. */
  failures: OutcomeCounts;
  /** The plans with a draft under test, in the plans' order. */
  drafts: PlanId[];
  week: WeekActivity;
  usage: WeekUsage;
}) {
  const rate = failureRate(failures);
  const photos = (amount: WeekUsage["current"]) =>
    `${amount.photos.toLocaleString("ko-KR")}장 · ${usd(amount.usd)}`;
  return (
    <div className="flex flex-col gap-section-gap">
      <div className="grid gap-4 md:grid-cols-3">
        <TodoCard
          label="새 신고"
          figure={`${String(reports.notes)}건`}
          line={
            reports.oldestDays === null
              ? "처리할 신고가 없어요."
              : `가장 오래된 신고 ${ago(reports.oldestDays)}`
          }
          action={{ href: "/decks", label: "신고 보기" }}
        />
        <TodoCard
          label="사진 읽기 실패율 · 7일"
          figure={rate === null ? "–" : percent(rate)}
          alarm={rate !== null && rate > failureAlarm}
          line={
            rate === null
              ? "최근 7일에 기록된 추출이 없어요."
              : `추출 ${failures.calls.toLocaleString("ko-KR")}건 중 ${String(failures.invalidOutput + failures.modelError)}건 실패 · 5%를 넘으면 빨간색`
          }
          action={{ href: "/ai", label: "자세히" }}
        />
        {drafts[0] === undefined ? (
          <TodoCard
            label="테스트 중인 초안"
            figure="없음"
            line="관리자만 쓰는 초안이 없어요."
            action={{ href: "/ai", label: "AI 보기" }}
          />
        ) : (
          <TodoCard
            label="테스트 중인 초안"
            figure={drafts.map((plan) => planLabels[plan] ?? plan).join(" · ")}
            line="관리자만 쓰는 중이에요. 시험한 뒤 적용하거나 끝내요."
            action={{ href: `/ai?plan=${drafts[0]}`, label: "적용 또는 끝내기" }}
          />
        )}
      </div>
      <Section
        label="이번 주"
        note={`최근 7일을 그 전 7일과 비교해요. 사진은 UTC 날짜로 세고, 예상 비용은 모델마다 eval로 잰 비용이에요.${
          usage.unpricedModels.length === 0
            ? ""
            : ` 측정하지 않은 모델(${usage.unpricedModels.join(", ")})의 사진은 비용에서 빠졌어요.`
        }`}
      >
        <dl className={group}>
          <WeekRow
            term="새 사용자"
            previous={`지난주 ${people(week.newUsers.previous)}`}
            current={people(week.newUsers.current)}
            delta={change(week.newUsers)}
          />
          <WeekRow
            term="학습한 사용자"
            previous={`하루 평균 · 지난주 ${people(week.studiedDaily.previous)}`}
            current={people(week.studiedDaily.current)}
            delta={change(week.studiedDaily)}
          />
          <WeekRow
            term="읽은 사진 · 예상 비용"
            previous={`지난주 ${photos(usage.previous)}`}
            current={photos(usage.current)}
            delta={change({ current: usage.current.photos, previous: usage.previous.photos })}
          />
        </dl>
      </Section>
    </div>
  );
}
