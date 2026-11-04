import type { ReactNode } from "react";

import {
  EmptyHome,
  type LibraryFailure,
  NoCardsHome,
  ReadFailure,
  readDeckList,
} from "@/features/decks";
import {
  countDay,
  dayPlanOf,
  nextReviewOf,
  readToday,
  readyServerEngine,
  sessionMinutes,
  studyHref,
} from "@/features/study";

import { Mascot } from "@/design/brand";

import { EnterLink } from "./enter-link";
import { belowHero, heroFold, heroGroup } from "./hero-fold";
import { ProfileButton, readInitial } from "./profile-button";
import { WeekCard } from "./week-card";

/** Noon of the study day starting at [start], which names its calendar date in any zone. */
const noon = (start: number) => start + 12 * 3_600_000;

/**
 * 홈, read on the server, as the phone draws it (ADR 0165): the day on the `hero` surface under
 * the app's name and the profile button, and under it the week card, the streak over the last
 * seven study days. The hero holds today's count, its minutes and 시작; in a backlog, the
 * backlog's words and 시작; with nothing left, that the day is done, the next review and
 * 학습하기; with notes but no card, how to start, and no week card. With no note, the first run;
 * with a failed read of the notes, why. A day that cannot be counted leaves the hero with 시작
 * alone and puts why in the week card's place, since it asks the user to act. From 1024 px the
 * side menu's lockup draws the app's name, so 홈's is read and not drawn.
 */
export async function Today() {
  const [read, today, initial] = await Promise.all([
    readDeckList(),
    readToday({ streak: true, week: true }),
    readInitial(),
  ]);
  if ("failure" in read) {
    return (
      <>
        <h1 className="text-title lg:sr-only">알아몰라</h1>
        <ReadFailure failure={read.failure} />
      </>
    );
  }
  const { decks, cards } = read.library;
  if (decks.length === 0) {
    return (
      <>
        <div className="flex items-center justify-between gap-3 lg:sr-only">
          <h1 className="text-title">알아몰라</h1>
          <span className="lg:hidden">
            <ProfileButton initial={initial} />
          </span>
        </div>
        <EmptyHome />
      </>
    );
  }
  const href = studyHref(decks.map((deck) => deck.id));
  const counted = (failure: LibraryFailure) => (
    <Home
      initial={initial}
      hero={
        <>
          <Mascot expression="thinking" className="" />
          <h2 id="hero-title" className="sr-only">
            오늘 할 카드
          </h2>
          <StartLink href={href} />
        </>
      }
      problem={<ReadFailure failure={failure} />}
    />
  );
  // With notes but no card in any, how to start rather than a finished day, and no week.
  if (cards.length === 0) {
    return <Home initial={initial} hero={<NoCardsHome decks={decks} />} />;
  }
  if ("failure" in today) return counted(today.failure);
  // Today's list places the cards, as the study page and the phone do, so the counts agree.
  const engine = await readyServerEngine();
  if ("failure" in engine) return counted(engine.failure);
  const { day, states, pace, answers, streakBefore, timeZone, week } = today.today;
  const plan = dayPlanOf(cards, states, day, answers);
  const count = countDay(plan, states);
  const total = count.review + count.fresh;
  const streak = streakBefore + (answers.length > 0 ? 1 : 0);
  const below = <WeekCard streak={streak} week={week} />;
  const stored = Object.values(states).flatMap((state) => (state ? [state] : []));

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
      <Home
        initial={initial}
        below={below}
        hero={
          <>
            <Mascot expression="happy" className="" />
            <h2 id="hero-title" className="text-title break-keep">
              오늘 할 카드를 다 했어요
            </h2>
            <p className="text-body-strong break-keep">
              {next && nextDay
                ? `다음 복습은 ${nextDay} · ${String(next.cards)}장, 약 ${String(sessionMinutes(next.cards, 0, pace))}분`
                : "앞으로 7일 동안 복습할 카드가 없어요"}
            </p>
            <StartLink href={href} label="학습하기" />
          </>
        }
      />
    );
  }

  return (
    <Home
      initial={initial}
      below={below}
      hero={
        count.backlog ? (
          <>
            <Mascot expression="thinking" className="" />
            <h2 id="hero-title" className="text-title break-keep">
              다시 시작하면 돼요
            </h2>
            <p className="text-body-strong break-keep">
              밀린 복습 {total}장을 급한 것부터 해요. 새 카드는 잠시 쉬어요.
            </p>
            <StartLink href={href} />
          </>
        ) : (
          <>
            <Mascot expression="happy" className="" />
            <h2 id="hero-title" className="font-display text-hero-figure tabular-nums">
              오늘 {total}장
            </h2>
            <p id="hero-time" className="text-body-strong">
              약 {sessionMinutes(count.review, count.fresh, pace)}분이면 끝나요
            </p>
            <StartLink href={href} />
          </>
        )
      }
    />
  );
}

/** The hero's study link, "시작" unless [label] says otherwise, over every note. */
function StartLink({ href, label = "시작" }: { href: string; label?: string }) {
  return (
    <div className="mt-2 flex w-full justify-center">
      <EnterLink href={href} label={label} onHero />
    </div>
  );
}

/**
 * 홈's two parts: the [hero] on the `hero` surface, rounded at its foot, under "알아몰라" and,
 * below 1024 px, the profile button with the account's [initial]; under it [below], the week card.
 * Why the day cannot be read, [problem], is in the hero under its action, on a `surface` row, so
 * it is on the first screen. From 1024 px the profile button is the side menu's.
 *
 * Below 1024 px the hero fills the screen above the tab bar but for [below]'s top edge, which
 * shows at the foot of the first screen; the rest of [below] follows by scrolling (ADR 0179). The
 * hero's first item, the mascot, is at `mascot-hero`, the group centred.
 */
function Home({
  hero,
  below,
  problem,
  initial,
}: {
  hero: ReactNode;
  below?: ReactNode;
  problem?: ReactNode;
  initial: string | null;
}) {
  return (
    // One block, so that main's gap does not come between the hero and what is under it.
    <div>
      <section
        aria-labelledby="hero-title"
        className={`${heroFold(below !== undefined)} -mx-gutter rounded-b-sheet bg-hero px-gutter pt-6 pb-5 text-on-hero lg:mx-0 lg:rounded-card lg:p-8`}
      >
        <div className="mb-4 flex items-center justify-between gap-3 lg:sr-only">
          <h1 className="text-title">알아몰라</h1>
          <span className="lg:hidden">
            <ProfileButton initial={initial} onHero />
          </span>
        </div>
        <div className={heroGroup}>{hero}</div>
        {problem && <div className="mt-4 rounded-row bg-surface p-4">{problem}</div>}
      </section>
      {below && <div className={belowHero}>{below}</div>}
    </div>
  );
}
