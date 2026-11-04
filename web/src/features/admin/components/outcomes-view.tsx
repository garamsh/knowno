import Link from "next/link";

import { Chip } from "@/design/chip";

import { formatTime } from "../format";
import { labelOf, planLabels } from "../labels";
import {
  type ExtractionCall,
  failed,
  failureRate,
  failureWords,
  outcomeWords,
  type OutcomeSummary,
  percent,
} from "../outcomes";
import { Section } from "@/design/section";
import { button, Empty, group, row } from "./admin-section";

/** The scale's top: the highest day's rate rounded up to a step of 5%, at least 5%. */
function scaleTop(days: OutcomeSummary["days"]): number {
  const highest = Math.max(0, ...days.map(({ counts }) => failureRate(counts) ?? 0));
  return Math.max(5, Math.ceil((highest * 100) / 5) * 5);
}

/**
 * One version's failure rate each day, as a bar, today's in ink and the others ink at 55%, as the
 * 기록 page draws its weeks; a day without a recorded call draws none. One image named by every
 * day's rate.
 */
export function DailyRates({ days }: { days: OutcomeSummary["days"] }) {
  const top = scaleTop(days);
  const shown = days.filter(({ counts }) => counts.calls > 0);
  const label =
    shown.length === 0
      ? "날짜별 실패율: 기록된 추출이 없어요."
      : `날짜별 실패율, 최근 30일: ${shown
          .map(({ day, counts }) => `${day.slice(5)} ${percent(failureRate(counts) ?? 0)}`)
          .join(", ")}`;
  return (
    <Section label="날짜별 실패율" note="최근 30일, UTC 날짜 기준이에요">
      <div className="flex flex-col gap-1 rounded-group bg-surface p-4">
        <div className="flex gap-2">
          <div
            aria-hidden
            className="flex w-9 flex-col justify-between text-right text-micro text-muted"
          >
            <span className="-translate-y-2">{top}%</span>
            <span className="translate-y-2">0%</span>
          </div>
          <div
            role="img"
            aria-label={label}
            className="flex h-28 min-w-0 flex-1 items-end gap-0.5 border-b border-hairline"
          >
            {days.map(({ day, counts }, index) => {
              const rate = failureRate(counts);
              return (
                <span
                  key={day}
                  className={`flex-1 rounded-t-sm ${index === days.length - 1 ? "bg-ink" : "bg-ink/55"}`}
                  style={{ height: rate === null ? 0 : `${String((rate * 100 * 100) / top)}%` }}
                />
              );
            })}
          </div>
        </div>
        <div aria-hidden className="flex justify-between pl-11 text-caption text-muted">
          <span>{days.length - 1}일 전</span>
          <span>오늘</span>
        </div>
      </div>
    </Section>
  );
}

/** One extraction: its outcome and time, then its plan, calls, latency and cards. */
function CallRow({ call, timeZone }: { call: ExtractionCall; timeZone: string }) {
  const { result } = call;
  const details = [labelOf(planLabels, call.plan)];
  if (result !== null) {
    details.push(
      result.failures.length === 0
        ? `시도 ${String(result.attempts)}회`
        : `시도 ${String(result.attempts)}회 (${result.failures.map((kind) => failureWords[kind]).join(", ")})`,
      `${(result.latencyMs / 1000).toFixed(1)}초`,
      `카드 ${String(result.cardsReturned)}장`,
    );
    if (result.cardsDropped > 0) details.push(`거른 카드 ${String(result.cardsDropped)}장`);
  }
  return (
    <li className={row}>
      <span className="flex items-center justify-between gap-3">
        {result === null ? (
          <Chip>기록 없음</Chip>
        ) : (
          <Chip tone={failed(result.outcome) ? "amber" : "neutral"}>
            {outcomeWords[result.outcome]}
          </Chip>
        )}
        <span className="text-caption text-muted tabular-nums">
          {formatTime(call.at, timeZone)}
        </span>
      </span>
      <span className="text-caption text-ink-2">{details.join(" · ")}</span>
    </li>
  );
}

/**
 * A version's recorded extractions, newest first, a page at a time: [before] names the page's
 * address, and [more] whether an older page may exist. The user a call served is not shown.
 */
export function VersionCalls({
  versionId,
  calls,
  before,
  more,
  timeZone,
}: {
  versionId: number;
  calls: ExtractionCall[];
  before: number | null;
  more: boolean;
  timeZone: string;
}) {
  const page = `/ai/${String(versionId)}`;
  return (
    <Section label="최근 추출">
      {before !== null && (
        <Link
          href={page}
          className="self-start px-1 text-body text-ink-2 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
        >
          최신 추출로
        </Link>
      )}
      {calls.length === 0 ? (
        <Empty>
          {before === null
            ? "이 버전으로 기록된 추출이 없어요. 사진으로 카드를 만들면 여기에 쌓여요."
            : "이보다 이전 추출이 없어요. 최신 추출로 돌아가 보세요."}
        </Empty>
      ) : (
        <ul aria-label="최근 추출" className={group}>
          {calls.map((call) => (
            <CallRow key={call.usageId} call={call} timeZone={timeZone} />
          ))}
        </ul>
      )}
      {more && calls.length > 0 && (
        <Link
          href={`${page}?before=${String(calls[calls.length - 1]?.usageId)}`}
          className={button.secondary}
        >
          이전 추출 더 보기
        </Link>
      )}
    </Section>
  );
}
