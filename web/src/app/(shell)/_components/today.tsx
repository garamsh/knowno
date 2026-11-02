import type { ReactNode } from "react";

import {
  AuthoringButton,
  type Deck,
  DeckList,
  EmptyHome,
  type LibraryFailure,
  NoCardsHome,
  ReadFailure,
  readDeckList,
} from "@/features/decks";
import {
  countDay,
  dayPlanOf,
  deckProgress,
  nextReviewOf,
  readToday,
  readyServerEngine,
  sessionMinutes,
  studyHref,
} from "@/features/study";

import { Mascot } from "@/design/brand";

import { EnterLink } from "./enter-link";

/** Noon of the study day starting at [start], which names its calendar date in any zone. */
const noon = (start: number) => start + 12 * 3_600_000;

/**
 * 홈, read on the server, as the final screens draw option 6 (ADR 0150): the day on the `hero`
 * surface under the app's name and the streak, and under it the notes as a drawer, whose rows
 * carry each note's count for today. The hero holds today's count, its minutes and 시작; in a
 * backlog, the backlog's words and 시작; with nothing left, that the day is done, the next review
 * and 학습하기, the drawer starting higher; with notes but no card, how to start. With no note, the
 * first run; with a failed read of the notes, why. A day that cannot be counted leaves the hero
 * with 시작 alone and puts why at the top of the drawer, since it asks the user to act.
 */
export async function Today() {
  const [read, today] = await Promise.all([readDeckList(), readToday({ streak: true })]);
  if ("failure" in read) {
    return (
      <>
        <h1 className="text-display">알아몰라</h1>
        <ReadFailure failure={read.failure} />
      </>
    );
  }
  const { decks, cards } = read.library;
  if (decks.length === 0) return <EmptyHome />;
  const href = studyHref(decks.map((deck) => deck.id));
  const counted = (failure: LibraryFailure) => (
    <Home
      hero={
        <>
          <Mascot expression="thinking" className="size-mascot-large" />
          <h2 id="hero-title" className="sr-only">
            오늘 할 카드
          </h2>
          <StartLink href={href} />
        </>
      }
      raised={false}
      decks={decks.map((deck) => ({
        deck,
        cards: cards.filter((card) => card.deckId === deck.id).length,
        today: 0,
      }))}
      notice={<ReadFailure failure={failure} />}
    />
  );
  if ("failure" in today) return counted(today.failure);
  // With notes but no card in any, how to start rather than a finished day.
  if (cards.length === 0) {
    return (
      <Home
        hero={<NoCardsHome decks={decks} />}
        raised
        decks={decks.map((deck) => ({ deck, cards: 0, today: 0, mastered: 0, learning: 0 }))}
      />
    );
  }
  // Today's list places the cards, as the study page and the phone do, so the counts agree.
  const engine = await readyServerEngine();
  if ("failure" in engine) return counted(engine.failure);
  const { day, states, pace, answers, streakBefore, timeZone } = today.today;
  const plan = dayPlanOf(cards, states, day, answers);
  const count = countDay(plan, states);
  const total = count.review + count.fresh;
  const streak = streakBefore + (answers.length > 0 ? 1 : 0);
  const rows = decks.map((deck) => {
    const own = cards.filter((card) => card.deckId === deck.id);
    const left = countDay(dayPlanOf(own, states, day, answers), states);
    const { mastered, learning } = deckProgress(own, states);
    return { deck, cards: own.length, today: left.review + left.fresh, mastered, learning };
  });
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
        streak={streak}
        raised
        decks={rows}
        hero={
          <>
            <Mascot expression="happy" className="size-mascot-hero" />
            <h2 id="hero-title" className="text-display break-keep">
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
      streak={streak}
      raised={false}
      decks={rows}
      hero={
        count.backlog ? (
          <>
            <Mascot expression="thinking" className="size-mascot-large" />
            <h2 id="hero-title" className="text-display break-keep">
              다시 시작하면 돼요
            </h2>
            <p className="text-body-strong break-keep">
              밀린 복습 {total}장을 급한 것부터 해요. 새 카드는 잠시 쉬어요.
            </p>
            <StartLink href={href} />
          </>
        ) : (
          <>
            <Mascot expression="happy" className="size-mascot-hero" />
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
    <div className="mt-4 flex w-full justify-center">
      <EnterLink href={href} label={label} onHero />
    </div>
  );
}

/**
 * 홈's two parts: the [hero] on the `hero` surface under "알아몰라" and the streak badge, the
 * streak on a card in the accent; under it the notes, a drawer below 1024 px that the page's
 * scroll pulls up, which starts higher when [raised], and from 1024 px a column under the hero
 * card. The drawer holds [notice] above the rows and "새 노트" beside its search.
 */
function Home({
  hero,
  decks,
  raised,
  streak = 0,
  notice,
}: {
  hero: ReactNode;
  decks: { deck: Deck; cards: number; today: number; mastered?: number; learning?: number }[];
  raised: boolean;
  streak?: number;
  notice?: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <section
        aria-labelledby="hero-title"
        className={`-mx-gutter -mt-6 flex flex-col bg-hero px-gutter pt-6 pb-14 text-on-hero lg:mx-0 lg:mt-0 lg:min-h-0 lg:rounded-card lg:p-8 ${raised ? "min-h-[calc(100dvh-26rem)]" : "min-h-[calc(100dvh-13.5rem)]"}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-display">알아몰라</h1>
          {streak > 0 && (
            <span className="rounded-chip bg-surface px-3.5 py-1.5 text-label text-accent shadow-row">
              {streak}일 연속
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-1 py-6 text-center">
          {hero}
        </div>
      </section>
      <div className="relative -mx-gutter -mt-8 flex flex-col gap-3 rounded-t-sheet bg-ground px-gutter pt-3 lg:mx-0 lg:mt-6 lg:rounded-none lg:p-0">
        <span aria-hidden className="mx-auto block h-1.5 w-11 rounded-full bg-edge lg:hidden" />
        <DeckList rows={decks} notice={notice} action={<AuthoringButton compact />} />
      </div>
    </div>
  );
}
