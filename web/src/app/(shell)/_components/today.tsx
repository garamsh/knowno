import { Flame, Play } from "lucide-react";
import Link from "next/link";

import { Chip } from "@/design/chip";
import {
  type Deck,
  DeckTile,
  EmptyHome,
  NoCardsHome,
  ReadFailure,
  readDeckList,
} from "@/features/decks";
import {
  catchUp,
  countDay,
  dailyGoal,
  dailyLoad,
  dayPlanOf,
  deckProgress,
  lastWeek,
  nextReviewOf,
  readRecentRetention,
  readToday,
  readyServerEngine,
  RetentionPreview,
  sessionMinutes,
  studyHref,
  type WeekDay,
} from "@/features/study";

import { Mascot } from "@/design/brand";

import { EnterLink } from "./enter-link";

/** Noon of the study day starting at [start], which names its calendar date in any zone. */
const noon = (start: number) => start + 12 * 3_600_000;

/** The page's heading, "오늘", with the day's date beside it once the day is read. */
function Heading({ day }: { day?: { start: number; timeZone: string } }) {
  return (
    <header className="flex flex-wrap items-baseline gap-x-3">
      <h1 className="text-display">오늘</h1>
      {day && (
        <span className="text-label font-normal text-muted">
          {new Intl.DateTimeFormat("ko-KR", {
            month: "long",
            day: "numeric",
            weekday: "long",
            timeZone: day.timeZone,
          }).format(noon(day.start))}
        </span>
      )}
    </header>
  );
}

/**
 * The 오늘 page's content, read on the server, under its heading, as the phone's 오늘 tab draws the
 * day: with cards left, the today card, the last seven study days and today's decks; in a backlog,
 * the backlog card and its catch-up; with nothing left, the done card, the last seven study days
 * and 학습하기; then the retention of the last 30 days. With no deck, the first-run invitation;
 * with decks but no card in any, the invitation to add cards; with a failed read, why, under the
 * heading still.
 */
export async function Today() {
  const [read, today, retention] = await Promise.all([
    readDeckList(),
    readToday({ streak: true }),
    readRecentRetention(),
  ]);
  const heading = (
    <Heading
      day={
        "failure" in today
          ? undefined
          : { start: today.today.day.start, timeZone: today.today.timeZone }
      }
    />
  );
  const failed = (failure: Parameters<typeof ReadFailure>[0]["failure"]) => (
    <>
      {heading}
      <ReadFailure failure={failure} />
    </>
  );
  if ("failure" in read) return failed(read.failure);
  if ("failure" in today) return failed(today.failure);
  if ("failure" in retention) return failed(retention.failure);
  const { decks, cards } = read.library;
  const { day, states, pace, answers, streakBefore, timeZone } = today.today;
  if (decks.length === 0) {
    return (
      <>
        {heading}
        <EmptyHome />
      </>
    );
  }
  // With decks but no card in any, how to start rather than a finished day.
  if (cards.length === 0) {
    return (
      <>
        {heading}
        <NoCardsHome decks={decks} />
      </>
    );
  }

  // Today's list places the cards, as the study page and the phone do, so the counts agree.
  const engine = await readyServerEngine();
  if ("failure" in engine) return failed(engine.failure);
  const plan = dayPlanOf(cards, states, day, answers);
  const count = countDay(plan, states);
  const total = count.review + count.fresh;
  const minutes = sessionMinutes(count.review, count.fresh, pace);
  const goal = dailyGoal(plan);
  const streak = streakBefore + (answers.length > 0 ? 1 : 0);
  const stored = Object.values(states).flatMap((state) => (state ? [state] : []));
  const href = studyHref(decks.map((deck) => deck.id));
  const week = (
    <LastWeek
      week={lastWeek({
        days: retention.studyDays,
        times: today.today.earlierTimes,
        today: answers,
        todayStart: day.start,
        timeZone,
      })}
      timeZone={timeZone}
    />
  );
  const rows = decks.flatMap((deck) => {
    const own = cards.filter((card) => card.deckId === deck.id);
    const left = countDay(dayPlanOf(own, states, day, answers), states);
    const n = left.review + left.fresh;
    if (n === 0) return [];
    const { mastered } = deckProgress(own, states);
    return [{ deck, today: n, mastered: mastered / own.length }];
  });
  const extraChip = plan.extra.size > 0 && <Chip>오늘 {plan.extra.size}장 더 했어요</Chip>;
  const streakChip = streak > 0 && (
    <Chip leading={<Flame aria-hidden className="size-4 text-streak" strokeWidth={2} />}>
      {streak}일 연속
    </Chip>
  );

  if (total === 0) {
    const next = nextReviewOf(stored, day, timeZone);
    const nextDay =
      next &&
      (next.after === 1
        ? "내일"
        : new Intl.DateTimeFormat("ko-KR", { weekday: "long", timeZone }).format(
            noon(day.start) + next.after * 86_400_000,
          ));
    return (
      <>
        {heading}
        <div className="grid gap-4 lg:grid-cols-2">
          <section
            aria-labelledby="today-title"
            className="flex flex-col items-center gap-2 rounded-card bg-surface p-6 text-center text-ink shadow-card lg:col-span-2"
          >
            <Mascot expression="happy" className="size-mascot-medium" />
            <h2 id="today-title" className="mt-1 text-body-strong">
              오늘 할 카드를 다 했어요
            </h2>
            <p className="text-secondary text-ink-2">
              {next && nextDay
                ? `다음 복습은 ${nextDay} · ${String(next.cards)}장, 약 ${String(sessionMinutes(next.cards, 0, pace))}분`
                : "앞으로 7일 동안 복습할 카드가 없어요"}
            </p>
            <p className="flex flex-wrap items-center justify-center gap-2 text-secondary">
              {streakChip}
              {goal.goal > 0 && <Chip>목표 {goal.goal}장 달성</Chip>}
              {extraChip}
            </p>
            {/* A row, so the link keeps its row sizes inside the card's column. */}
            <div className="flex w-full flex-wrap justify-center">
              <EnterLink href={href} label="학습하기" />
            </div>
          </section>
          {week}
          <RetentionPreview days={retention.days} timeZone={retention.timeZone} />
        </div>
      </>
    );
  }

  if (count.backlog) {
    const load = Math.max(1, Math.ceil(dailyLoad(stored)));
    return (
      <>
        {heading}
        <div className="grid gap-4 lg:grid-cols-2">
          <section
            aria-labelledby="today-title"
            className="flex flex-col gap-4 rounded-card bg-surface p-6 text-ink shadow-card lg:col-span-2 lg:p-7"
          >
            <div className="flex items-center gap-4">
              <Mascot expression="thinking" className="size-mascot-guide shrink-0" />
              <div className="flex min-w-0 flex-col gap-1">
                <h2 id="today-title" className="text-body-strong">
                  다시 시작하면 돼요
                </h2>
                <p className="text-secondary break-keep text-muted">
                  밀린 복습 {total}장을 급한 것부터 해요. 새 카드는 잠시 쉬어요.
                </p>
              </div>
            </div>
            {streak > 0 && (
              <p className="flex flex-wrap items-center gap-2 text-secondary">{streakChip}</p>
            )}
            {/* A row, so the link keeps its row sizes inside the card's column. */}
            <div className="flex flex-wrap">
              <EnterLink href={href} label="모두 학습" />
            </div>
          </section>
          <CatchUp backlog={total} perDay={load} start={day.start} timeZone={timeZone} />
          <RetentionPreview days={retention.days} timeZone={retention.timeZone} />
        </div>
      </>
    );
  }

  return (
    <>
      {heading}
      <div className="grid gap-4 lg:grid-cols-2">
        <section
          aria-labelledby="today-title"
          className="flex flex-col gap-4 rounded-card bg-surface p-6 text-ink shadow-card lg:col-span-2 lg:p-7"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-secondary">
            <h2 id="today-title" className="text-label font-normal text-muted">
              오늘 할 카드
            </h2>
            {streakChip}
          </div>
          <div className="flex flex-wrap items-end justify-between gap-x-3">
            {/* The bar under it reads the same figures. */}
            <p id="today-count" aria-hidden>
              <span className="text-figure">{goal.done}</span>
              <span className="text-headline text-muted"> / {goal.goal}장</span>
            </p>
            <p id="today-time" className="text-secondary text-muted">
              약 {minutes}분{goal.done > 0 && " 남음"}
            </p>
          </div>
          <div
            role="progressbar"
            aria-label={`${String(goal.goal)}장 중 ${String(goal.done)}장`}
            aria-valuemin={0}
            aria-valuemax={goal.goal}
            aria-valuenow={goal.done}
            className="h-progress overflow-hidden rounded-full bg-edge"
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${String(goal.goal === 0 ? 0 : (goal.done / goal.goal) * 100)}%` }}
            />
          </div>
          {extraChip && (
            <p className="flex flex-wrap items-center gap-2 text-secondary">{extraChip}</p>
          )}
          {/* A row, so the link keeps its row sizes inside the card's column. */}
          <div className="flex flex-wrap">
            <EnterLink href={href} label="모두 학습" />
          </div>
        </section>
        {week}
        {rows.length > 0 && <TodayDecks rows={rows} />}
        <RetentionPreview days={retention.days} timeZone={retention.timeZone} />
      </div>
    </>
  );
}

/**
 * In a backlog: the overdue reviews left at the start of each of the seven study days from today
 * when [perDay] are cleared a day, as bars, today's coral, under how many days that takes.
 */
function CatchUp({
  backlog,
  perDay,
  start,
  timeZone,
}: {
  backlog: number;
  perDay: number;
  start: number;
  timeZone: string;
}) {
  const left = catchUp(backlog, perDay);
  const weekday = new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone });
  const labels = left.map((_, index) =>
    index === 0 ? "오늘" : index === 1 ? "내일" : weekday.format(noon(start) + index * 86_400_000),
  );
  const highest = Math.max(1, ...left);
  return (
    <section
      aria-labelledby="catch-up-title"
      className="flex flex-col gap-3.5 rounded-card bg-surface p-5"
    >
      <h2 id="catch-up-title" className="text-body-strong">
        하루 {perDay}장씩 하면 {Math.ceil(backlog / perDay)}일이면 따라잡아요
      </h2>
      <div
        role="img"
        aria-label={`밀린 복습 예상: ${labels
          .map((label, index) => `${label} ${String(left[index] ?? 0)}장`)
          .join(", ")}`}
        className="grid h-28 grid-cols-7 gap-2.5"
      >
        {left.map((value, index) => (
          <div key={labels[index]} className="flex flex-col items-center justify-end gap-1">
            <span className="text-micro font-bold">{value}</span>
            <span
              className={`w-full rounded-md ${index === 0 ? "bg-accent" : "bg-chart-quiet"}`}
              style={{ height: `${String(Math.max(4, (value / highest) * 64))}px` }}
            />
            <span className="text-micro text-muted">{labels[index]}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The last seven study days as bars of the cards answered on each, today's coral and last, under
 * the heading; the whole card links to 기록, which reads it as one sentence and each day's count.
 */
function LastWeek({ week, timeZone }: { week: WeekDay[]; timeZone: string }) {
  const short = new Intl.DateTimeFormat("ko-KR", { weekday: "short", timeZone });
  const long = new Intl.DateTimeFormat("ko-KR", { weekday: "long", timeZone });
  const labels = week.map((day, index) =>
    index === week.length - 1 ? "오늘" : short.format(noon(day.start)),
  );
  const cards = week.reduce((sum, day) => sum + day.cards, 0);
  const minutes = Math.ceil(week.reduce((sum, day) => sum + day.ms, 0) / 60_000);
  const highest = Math.max(1, ...week.map((day) => day.cards));
  const summary = `지난 7일 동안 ${String(cards)}장을 ${String(minutes)}분 학습했어요`;
  return (
    <Link
      href="/record"
      aria-label={[
        summary,
        ...week.map((day) => `${long.format(noon(day.start))} ${String(day.cards)}장`),
      ].join(", ")}
      aria-describedby="last-week-open"
      className="pressable flex flex-col gap-3.5 rounded-card bg-surface p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <span id="last-week-open" className="sr-only">
        기록 열기
      </span>
      <span className="text-body-strong">지난 7일</span>
      <span aria-hidden className="grid h-28 grid-cols-7 gap-2.5">
        {week.map((day, index) => (
          <span key={day.start} className="flex flex-col items-center justify-end gap-1">
            <span className="text-micro font-bold">{day.cards}</span>
            <span
              className={`w-full rounded-md ${index === week.length - 1 ? "bg-accent" : "bg-chart-quiet"}`}
              style={{ height: `${String(Math.max(4, (day.cards / highest) * 64))}px` }}
            />
            <span className="text-micro text-muted">{labels[index]}</span>
          </span>
        ))}
      </span>
    </Link>
  );
}

/** Each deck with cards left today, which opens a session over it. */
function TodayDecks({ rows }: { rows: { deck: Deck; today: number; mastered: number }[] }) {
  return (
    <section
      aria-labelledby="today-decks-title"
      className="flex flex-col gap-1.5 rounded-card bg-surface p-5"
    >
      <h2 id="today-decks-title" className="text-body-strong">
        오늘 할 덱
      </h2>
      <ul className="flex flex-col">
        {rows.map(({ deck, today, mastered }) => (
          <li key={deck.id}>
            <Link
              href={studyHref([deck.id])}
              aria-label={`${deck.name}, 오늘 ${String(today)}장 학습`}
              className="flex min-h-13 items-center gap-3 rounded-field px-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <DeckTile deck={deck} size="size-8.5 text-secondary" />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-body-strong">{deck.name}</span>
                <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-edge">
                  <span
                    className="block h-full bg-accent"
                    style={{ width: `${String(mastered * 100)}%` }}
                  />
                </span>
              </span>
              <span className="text-caption font-bold">{today}장</span>
              <Play aria-hidden className="size-small-icon" strokeWidth={2} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
