"use client";

import { type ReactNode, useId, useState } from "react";

import { Chip } from "@/design/chip";
import { FittedLine } from "@/design/fitted-line";

import { studyDayStart } from "../queue";
import {
  calendarDate,
  heatLevel,
  masteredGain,
  periodStart,
  type RecallBands,
  type RecordDay,
  retentionIn,
  retentionOver,
  share,
  type StatsPeriod,
  type StudyDayCount,
  targetRetention,
} from "../stats";
import { bandShades, heatShades, quietWeekShade } from "./record-shades";

/** What the 기록 page shows, as the server read it (`readRecord`). */
export type RecordViewProps = {
  now: number;
  timeZone: string;
  days: RecordDay[];
  recall: RecallBands;
  mastered: number[];
  studyDays: StudyDayCount[];
  streak: number;
  bestStreak: number;
};

const periods: readonly { value: StatsPeriod; label: string }[] = [
  { value: "week", label: "7일" },
  { value: "month", label: "30일" },
  { value: "all", label: "전체" },
];

/** A share as whole percent. */
function percent(value: number): number {
  return Math.round(value * 100);
}

/** "10월 12일": the calendar date at midnight UTC [date] names, in Korean. */
function dateLabel(date: number): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * The 기록 page's content (ADR 0037, ADR 0151): the 7일, 30일 and 전체 selector the retention alone
 * follows, then the retention against its target with the gap and a line of each study day; the
 * recall bands now; the mastered cards now and over the last eight weeks; and twelve weeks of study
 * days, today's outlined, with the current and the best streak. Each chart is read as one label that
 * states its values.
 */
export function RecordView(props: RecordViewProps) {
  const [period, setPeriod] = useState<StatsPeriod>("month");
  return (
    <div className="flex flex-col gap-4">
      <PeriodChoice period={period} onChange={setPeriod} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <RetentionCard {...props} period={period} />
        </div>
        <RecallCard bands={props.recall} />
        <MasteredCard weeks={props.mastered} />
        <div className="lg:col-span-2">
          <StudyDaysCard days={props.studyDays} streak={props.streak} best={props.bestStreak} />
        </div>
      </div>
    </div>
  );
}

/**
 * 7일, 30일 and 전체, the periods the retention is read over, as one radio group named "기간": a
 * segmented control on its edge, the chosen period on the primary fill.
 */
function PeriodChoice({
  period,
  onChange,
}: {
  period: StatsPeriod;
  onChange: (period: StatsPeriod) => void;
}) {
  const label = useId();
  return (
    <div
      role="radiogroup"
      aria-labelledby={label}
      className="grid grid-cols-3 gap-1 rounded-field bg-surface p-1 shadow-row lg:max-w-list"
    >
      <span id={label} className="sr-only">
        기간
      </span>
      {periods.map(({ value, label: name }) => (
        <label key={value} className="flex">
          <input
            type="radio"
            name="period"
            value={value}
            checked={period === value}
            onChange={() => {
              onChange(value);
            }}
            className="peer sr-only"
          />
          <span className="flex min-h-tap-target flex-1 cursor-pointer items-center justify-center rounded-chip px-3 text-label text-ink-2 peer-checked:bg-primary peer-checked:text-on-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink">
            {name}
          </span>
        </label>
      ))}
    </div>
  );
}

/** A chart on the surface, raised on its edge, under its heading with an optional line beside it. */
function Card({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: string | null;
  children: ReactNode;
}) {
  const heading = useId();
  return (
    <section
      aria-labelledby={heading}
      className="flex h-full flex-col gap-3 rounded-card bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h2 id={heading} className="text-label text-ink">
          {title}
        </h2>
        {trailing && <p className="text-caption text-ink-2">{trailing}</p>}
      </div>
      {children}
    </section>
  );
}

/** A sentence in place of a chart with nothing to show. */
function Empty({ children }: { children: string }) {
  return <p className="text-secondary text-ink-2">{children}</p>;
}

/** A figure with its pill beside it, or under it where both do not fit. */
function Figure({ value, pill }: { value: string; pill: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="text-figure text-ink">{value}</p>
      {pill}
    </div>
  );
}

/** The chip beside a figure: a gain on the green tint, a shortfall on the amber. */
function Pill({ shortfall = false, children }: { shortfall?: boolean; children: string }) {
  return <Chip tone={shortfall ? "amber" : "knowTint"}>{children}</Chip>;
}

/** The retention over [period]: its value against the target, the gap, and each day's share. */
function RetentionCard({ days, now, timeZone, period }: RecordViewProps & { period: StatsPeriod }) {
  const shown = retentionIn(days, period, now, timeZone);
  const total = retentionOver(shown);
  const target = percent(targetRetention);
  if (!total) {
    return (
      <Card title="복습에서 맞힌 비율">
        <Empty>이 기간에 복습한 카드가 없어요.</Empty>
      </Card>
    );
  }
  const value = percent(share(total));
  const gap = value - target;
  // Each study day's place from the period's first day, today last.
  const today = studyDayStart(now, timeZone);
  const first = periodStart(period, now, timeZone) ?? shown[0]?.dayStart ?? today;
  const starts = [today];
  while ((starts[starts.length - 1] ?? today) > first) {
    starts.push(studyDayStart((starts[starts.length - 1] ?? today) - 1000, timeZone));
  }
  starts.reverse();
  const index = new Map(starts.map((start, position) => [start, position]));
  const points = shown.map((day) => ({ x: index.get(day.dayStart) ?? 0, share: share(day) }));
  const description = shown
    .map(
      (day) => `${dateLabel(calendarDate(day.dayStart, timeZone))} ${String(percent(share(day)))}%`,
    )
    .join(", ");
  const periodDays = period === "week" ? 7 : period === "month" ? 30 : null;
  return (
    <Card title="복습에서 맞힌 비율">
      <Figure
        value={`${String(value)}%`}
        pill={
          <Pill shortfall={gap < 0}>
            {gap < 0
              ? `목표보다 ${String(-gap)}% 낮아요`
              : gap > 0
                ? `목표보다 ${String(gap)}% 높아요`
                : "목표만큼 맞혔어요"}
          </Pill>
        }
      />
      <figure role="img" aria-label={`복습에서 맞힌 비율, 목표 ${String(target)}%: ${description}`}>
        <RetentionChart points={points} span={starts.length} />
        <div aria-hidden className="mt-1 flex justify-between text-caption text-ink-2">
          <span>
            {periodDays === null
              ? dateLabel(calendarDate(first, timeZone))
              : `${String(periodDays)}일 전`}
          </span>
          <span>오늘</span>
        </div>
      </figure>
    </Card>
  );
}

/** The chart's height and its scale's floor, the lowest it reaches down to at most. */
const chartHeight = 110;
const scaleFloor = 0.8;

/**
 * A line through each of [points], placed by its day from the first of [span] days and by its
 * share, over a soft fill, from at most its floor to 100%, with the target dashed across it and named
 * on its line at the left, and today ringed; only the axis's ends are labelled, under it.
 */
function RetentionChart({
  points,
  span,
}: {
  points: { x: number; share: number }[];
  span: number;
}) {
  const lowest = Math.min(...points.map((point) => point.share));
  const floor = Math.min(scaleFloor, Math.floor(lowest * 10) / 10);
  const y = (value: number) => ((1 - value) / (1 - floor)) * chartHeight;
  const x = (day: number) => (span <= 1 ? 100 : (day / (span - 1)) * 100);
  const line = points.map((point) => `${String(x(point.x))},${String(y(point.share))}`).join(" ");
  const area = `${String(x(points[0]?.x ?? 0))},${String(chartHeight)} ${line} ${String(x(points[points.length - 1]?.x ?? 0))},${String(chartHeight)}`;
  const last = points[points.length - 1];
  const targetTop = (y(targetRetention) / chartHeight) * 100;
  return (
    <div aria-hidden className="relative h-27.5">
      <svg
        viewBox={`0 0 100 ${String(chartHeight)}`}
        preserveAspectRatio="none"
        className="size-full overflow-visible"
      >
        {points.length > 1 && <polygon points={area} className="fill-accent/10" />}
        <line
          x1="0"
          x2="100"
          y1={y(targetRetention)}
          y2={y(targetRetention)}
          className="stroke-ink-2"
          strokeWidth="1.5"
          strokeDasharray="5 5"
          vectorEffect="non-scaling-stroke"
        />
        {points.length > 1 && (
          <polyline
            points={line}
            fill="none"
            className="stroke-accent"
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <span
        className="absolute left-0 -translate-y-1/2 bg-surface pr-1.5 text-micro font-bold text-ink-2"
        style={{ top: `${String(targetTop)}%` }}
      >
        목표 {percent(targetRetention)}%
      </span>
      {last && (
        <span
          className="absolute size-3.5 -translate-1/2 rounded-full border-3 border-accent bg-surface"
          style={{
            left: `${String(x(last.x))}%`,
            top: `${String((y(last.share) / chartHeight) * 100)}%`,
          }}
        />
      )}
    </div>
  );
}

/** The recall bands now: one bar of their shares, then a tile per band, and the mean. */
function RecallCard({ bands }: { bands: RecallBands }) {
  if (bands.mean === null) {
    return (
      <Card title="기억 상태">
        <Empty>아직 복습한 카드가 없어요.</Empty>
      </Card>
    );
  }
  const total = bands.strong + bands.fair + bands.fading;
  const mean = percent(bands.mean);
  const shares = [
    { name: "좋음", count: bands.strong, shade: bandShades.strong },
    { name: "보통", count: bands.fair, shade: bandShades.fair },
    { name: "곧 잊음", count: bands.fading, shade: bandShades.fading },
  ];
  return (
    <Card title="기억 상태" trailing={`평균 ${String(mean)}%`}>
      <div
        role="img"
        aria-label={`${String(total)}장 중 좋음 ${String(bands.strong)}장, 보통 ${String(bands.fair)}장, 곧 잊음 ${String(bands.fading)}장, 평균 ${String(mean)}%`}
        className="flex h-5.5 gap-0.75"
      >
        {shares.map(
          (band) =>
            band.count > 0 && (
              <span
                key={band.name}
                className={`rounded-lg ${band.shade}`}
                style={{ flexGrow: band.count }}
              />
            ),
        )}
      </div>
      <dl aria-hidden className="grid grid-cols-3 gap-2">
        {shares.map((band) => (
          <div key={band.name} className="flex flex-col gap-1 rounded-field bg-ground px-3 py-2.5">
            <dt className="flex items-center gap-1.5 text-caption font-bold text-ink-2">
              <span className={`size-2.5 shrink-0 rounded-xs ${band.shade}`} />
              {band.name}
            </dt>
            <dd className="text-display text-ink">
              <FittedLine>{band.count}장</FittedLine>
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/**
 * The mastered cards now as the figure with the gain beside it, then at the end of each of the last
 * eight weeks, this week's in the accent, the first and the last week named under them.
 */
function MasteredCard({ weeks }: { weeks: number[] }) {
  const most = Math.max(...weeks);
  if (most === 0) {
    return (
      <Card title="익힌 카드">
        <Empty>아직 익힌 카드가 없어요.</Empty>
      </Card>
    );
  }
  const gain = masteredGain(weeks);
  return (
    <Card title="익힌 카드">
      <Figure
        value={`${String(weeks[weeks.length - 1] ?? 0)}장`}
        pill={
          gain === null ? null : (
            <Pill>{`${String(weeks.length - 1)}주 전보다 +${String(gain)}장`}</Pill>
          )
        }
      />
      <div
        role="img"
        aria-label={`주별 익힌 카드, 7주 전부터 이번 주까지: ${weeks.map((count) => `${String(count)}장`).join(", ")}`}
        className="flex h-24 items-end gap-2"
      >
        {weeks.map((count, index) => (
          <span
            // The weeks are fixed in place, oldest first.
            key={index}
            className={`flex-1 rounded-t-lg rounded-b-sm ${index === weeks.length - 1 ? "bg-accent" : quietWeekShade}`}
            style={{ height: `${String((count / most) * 100)}%` }}
          />
        ))}
      </div>
      {/* The chart's label names every week; these name its two ends. */}
      <div aria-hidden className="flex justify-between text-caption text-ink-2">
        <span>{weeks.length - 1}주 전</span>
        <span>이번 주</span>
      </div>
    </Card>
  );
}

/**
 * Twelve weeks of study days, a column a week, in four cobalt steps by the cards answered, today's
 * outlined in ink, with the streaks; under them the first day's date, the steps' key and 오늘.
 */
function StudyDaysCard({
  days,
  streak,
  best,
}: {
  days: StudyDayCount[];
  streak: number;
  best: number;
}) {
  const most = Math.max(...days.map((day) => day.cards));
  const studied = days.filter((day) => day.cards > 0);
  return (
    <Card title="학습한 날" trailing={`${String(streak)}일 연속 · 최고 ${String(best)}일`}>
      <div
        role="img"
        aria-label={
          studied.length === 0
            ? "최근 12주 동안 학습한 날이 없어요"
            : `최근 12주 동안 ${String(studied.length)}일 학습했어요: ${studied.map((day) => `${dateLabel(day.date)} ${String(day.cards)}장`).join(", ")}`
        }
        className="grid max-w-list grid-flow-col grid-rows-7 gap-1"
      >
        {days.map((day, index) => (
          <span
            key={day.date}
            className={`aspect-square rounded-md ${heatShades[heatLevel(day.cards, most)] ?? heatShades[0]} ${
              index === days.length - 1 ? "outline-2 outline-offset-1 outline-ink" : ""
            }`}
          />
        ))}
      </div>
      {/* The label above reads every study day by its date; these place the grid in time and key
          its steps for the eye. */}
      <div
        aria-hidden
        className="flex max-w-list flex-wrap items-center justify-between gap-x-2 gap-y-1 text-caption text-ink-2"
      >
        <span>{days[0] ? dateLabel(days[0].date) : null}</span>
        <span className="flex items-center gap-1">
          적게
          {heatShades.map((shade) => (
            <span key={shade} className={`size-3 rounded-sm ${shade}`} />
          ))}
          많이
        </span>
        <span>오늘</span>
      </div>
    </Card>
  );
}
