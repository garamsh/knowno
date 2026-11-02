"use client";

import { type ReactNode, useId, useState } from "react";

import { Chip } from "@/design/chip";

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
 * The 기록 page's content (ADR 0037): the retention against its target with the gap and a line of
 * each study day, with the 7일, 30일 and 전체 selector it alone follows beside its heading; the
 * recall bands now; the mastered cards now and over the last eight weeks; and twelve weeks of study
 * days, today's ringed, with the current and the best streak. Each chart is read as one label that
 * states its values.
 */
export function RecordView(props: RecordViewProps) {
  const [period, setPeriod] = useState<StatsPeriod>("month");
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <RetentionCard
          {...props}
          period={period}
          control={<PeriodChoice period={period} onChange={setPeriod} />}
        />
      </div>
      <RecallCard bands={props.recall} />
      <MasteredCard weeks={props.mastered} />
      <div className="lg:col-span-2">
        <StudyDaysCard days={props.studyDays} streak={props.streak} best={props.bestStreak} />
      </div>
    </div>
  );
}

/** 7일, 30일 and 전체, the periods the retention is read over, as one radio group named "기간". */
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
      className="grid grid-cols-3 gap-1 rounded-field bg-brand-tint p-1"
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
          <span className="flex min-h-tap-target min-w-16 flex-1 cursor-pointer items-center justify-center rounded-button px-3 text-secondary font-semibold text-ink-2 peer-checked:bg-raised peer-checked:font-bold peer-checked:text-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink">
            {name}
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * A chart on the surface under its heading, with an optional line or [control] beside the heading;
 * the control goes under it where both do not fit.
 */
function Card({
  title,
  trailing,
  control,
  children,
}: {
  title: string;
  trailing?: string | null;
  control?: ReactNode;
  children: ReactNode;
}) {
  const heading = useId();
  return (
    <section
      aria-labelledby={heading}
      className="flex h-full flex-col gap-3 rounded-previous bg-surface p-4"
    >
      <div
        className={`flex justify-between gap-2 ${control ? "flex-wrap items-center" : "items-baseline"}`}
      >
        <h2 id={heading} className="text-label text-ink">
          {title}
        </h2>
        {trailing && <p className="text-caption text-ink-2">{trailing}</p>}
        {control}
      </div>
      {children}
    </section>
  );
}

/** A sentence in place of a chart with nothing to show. */
function Empty({ children }: { children: string }) {
  return <p className="text-secondary text-ink-2">{children}</p>;
}

/** The retention over [period]: its value against the target, the gap, and each day's share. */
function RetentionCard({
  days,
  now,
  timeZone,
  period,
  control,
}: RecordViewProps & { period: StatsPeriod; control: ReactNode }) {
  const shown = retentionIn(days, period, now, timeZone);
  const total = retentionOver(shown);
  const target = percent(targetRetention);
  if (!total) {
    return (
      <Card title="복습에서 맞힌 비율" control={control}>
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
    <Card title="복습에서 맞힌 비율" control={control}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex items-end gap-4">
          <p className="text-figure text-ink">{value}%</p>
        </div>
        <p className="mb-2">
          <Chip tone={gap < 0 ? "amber" : "brand"}>
            {gap < 0
              ? `목표보다 ${String(-gap)}% 낮아요`
              : gap > 0
                ? `목표보다 ${String(gap)}% 높아요`
                : "목표만큼 맞혔어요"}
          </Chip>
        </p>
      </div>
      <figure role="img" aria-label={`복습에서 맞힌 비율, 목표 ${String(target)}%: ${description}`}>
        <RetentionChart points={points} span={starts.length} />
        <div aria-hidden className="mt-1 flex justify-between pl-10 text-caption text-muted">
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
const chartHeight = 140;
const scaleFloor = 0.8;

/**
 * A line through each of [points], placed by its day from the first of [span] days and by its
 * share, over a scale from its floor to 100%, both labelled at its left (#155), with the target
 * dashed across it and named above the plot, where no line passes.
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
  return (
    <div aria-hidden className="flex flex-col gap-1">
      <p className="flex items-center justify-end gap-1.5 text-micro font-bold text-on-know-tint">
        <svg width="16" height="2" className="overflow-visible">
          <line
            x1="0"
            y1="1"
            x2="16"
            y2="1"
            className="stroke-know"
            strokeWidth="2"
            strokeDasharray="4 3"
          />
        </svg>
        목표 {percent(targetRetention)}%
      </p>
      <div className="flex gap-2">
        <div className="flex w-8 flex-col justify-between text-right text-micro text-muted">
          <span className="-translate-y-2">100%</span>
          <span className="translate-y-2">{percent(floor)}%</span>
        </div>
        <svg
          viewBox={`0 0 100 ${String(chartHeight)}`}
          preserveAspectRatio="none"
          className="h-35 min-w-0 flex-1 overflow-visible"
        >
          {[1, (1 + floor) / 2, floor].map((value) => (
            <line
              key={value}
              x1="0"
              x2="100"
              y1={y(value)}
              y2={y(value)}
              className="stroke-hairline"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1="0"
            x2="100"
            y1={y(targetRetention)}
            y2={y(targetRetention)}
            className="stroke-know"
            strokeWidth="2"
            strokeDasharray="5 5"
            vectorEffect="non-scaling-stroke"
          />
          {points.length > 1 && (
            <>
              <polygon points={area} className="fill-brand-tint" />
              <polyline
                points={line}
                fill="none"
                className="stroke-ink"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
          {last && (
            <line
              x1={x(last.x)}
              x2={x(last.x)}
              y1={y(last.share)}
              y2={y(last.share)}
              className="stroke-ink"
              strokeWidth="9"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
    </div>
  );
}

/** The recall bands now: one bar of their shares, each band's name and count, and the mean. */
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
        className="flex h-3.5 gap-0.5 overflow-hidden rounded-full"
      >
        {shares.map(
          (band) =>
            band.count > 0 && (
              <span key={band.name} className={band.shade} style={{ flexGrow: band.count }} />
            ),
        )}
      </div>
      <dl aria-hidden className="grid grid-cols-3 gap-2">
        {shares.map((band) => (
          <div key={band.name} className="flex flex-col gap-1">
            <dt className="flex items-center gap-1 text-caption text-ink-2">
              <span className={`size-2 rounded-xs ${band.shade}`} />
              {band.name}
            </dt>
            <dd className="text-label text-ink">{band.count}장</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/**
 * The mastered cards now as the figure, then at the end of each of the last eight weeks, this
 * week's in ink, the first and the last week named under them.
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
    <Card
      title="익힌 카드"
      trailing={gain === null ? null : `${String(weeks.length - 1)}주 전보다 +${String(gain)}장`}
    >
      <p className="text-figure text-ink">{weeks[weeks.length - 1] ?? 0}장</p>
      <div
        role="img"
        aria-label={`주별 익힌 카드, 7주 전부터 이번 주까지: ${weeks.map((count) => `${String(count)}장`).join(", ")}`}
        className="flex h-21 items-end gap-2"
      >
        {weeks.map((count, index) => (
          <span
            // The weeks are fixed in place, oldest first.
            key={index}
            className={`flex-1 rounded-sm ${index === weeks.length - 1 ? "bg-accent" : quietWeekShade}`}
            style={{ height: `${String((count / most) * 100)}%` }}
          />
        ))}
      </div>
      {/* The chart's label names every week; these name its two ends. */}
      <div aria-hidden className="flex justify-between text-caption text-muted">
        <span>{weeks.length - 1}주 전</span>
        <span>이번 주</span>
      </div>
    </Card>
  );
}

/**
 * Twelve weeks of study days, a column a week, shaded by the cards answered, today's ringed in ink,
 * with the streaks; under them the first day's date, the shades' key and 오늘.
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
            className={`aspect-square rounded-sm ${heatShades[heatLevel(day.cards, most)] ?? heatShades[0]} ${
              index === days.length - 1 ? "ring-2 ring-ink ring-inset" : ""
            }`}
          />
        ))}
      </div>
      {/* The label above reads every study day by its date; these place the grid in time and key
          its shades for the eye. */}
      <div
        aria-hidden
        className="flex max-w-list flex-wrap items-center justify-between gap-x-2 gap-y-1 text-caption text-muted"
      >
        <span>{days[0] ? dateLabel(days[0].date) : null}</span>
        <span className="flex items-center gap-1">
          적게
          {heatShades.map((shade) => (
            <span key={shade} className={`size-3 rounded-xs ${shade}`} />
          ))}
          많이
        </span>
        <span>오늘</span>
      </div>
    </Card>
  );
}
