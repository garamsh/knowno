import Link from "next/link";
import type { ReactNode } from "react";

import { ReadyBubble } from "@/features/assistant";
import { type Deck, type LibraryFailure, ReadFailure, readDeckList } from "@/features/decks";
import {
  countDay,
  dayPlanOf,
  nextReviewOf,
  readToday,
  readyServerEngine,
  sessionMinutes,
  studyHref,
} from "@/features/study";

import { Mascot, type MascotExpression } from "@/design/brand";
import { buttonClass } from "@/design/button";

import { EnterLink } from "./enter-link";
import {
  homeFrame,
  homeGround,
  homeMascot,
  homeMascotRoom,
  homeSky,
  homeWords,
} from "./home-frame";
import { ProfileButton, readInitial } from "./profile-button";
import { SkyThemeColor } from "./sky-theme-color";
import { StreakDays } from "./streak-days";

/** Noon of the study day starting at [start], which names its calendar date in any zone. */
const noon = (start: number) => start + 12 * 3_600_000;

/**
 * 홈, read on the server, as the phone draws it: one screen of the sky over the ground. In the sky
 * the app's name and the profile button, then the day's words, over a hill with the mascot on its
 * crest; on the ground the streak over the last seven study days and the one action. With cards
 * left, "오늘", their count and minutes and 시작 under the thinking mascot; in a backlog, the
 * backlog's words and 시작; with the day done, "오늘", "다 했어요" and the cards done today, or the
 * next review where none was due, under the sleepy mascot, and 학습하기; with notes but no card, how
 * to start, and no streak; with no note, how to start with 말랑이. A day that cannot be counted puts why in
 * the streak's place over 시작. With a failed read of the notes, why. From 1024 px the side
 * menu's lockup draws the app's name, so 홈's is read and not drawn.
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
      <Home
        initial={initial}
        mascot="thinking"
        words={<Title>첫 노트를 만들어 볼까요?</Title>}
        actions={
          <Link href="/assistant" className={`${buttonClass("primary", "cta")} w-full`}>
            말랑이와 첫 노트 만들기
          </Link>
        }
      />
    );
  }
  const href = studyHref(decks.map((deck) => deck.id));
  const counted = (failure: LibraryFailure) => (
    <Home
      initial={initial}
      mascot="thinking"
      words={
        <h2 id="hero-title" className="sr-only">
          오늘 할 카드
        </h2>
      }
      ground={
        <div className="w-full rounded-row bg-surface p-4">
          <ReadFailure failure={failure} />
        </div>
      }
      actions={<EnterLink href={href} label="시작" />}
    />
  );
  // With notes but no card in any, how to start rather than a finished day, and no streak.
  if (cards.length === 0) {
    return (
      <Home
        initial={initial}
        mascot="thinking"
        words={<Title>첫 카드를 만들어 볼까요?</Title>}
        actions={<AddCards decks={decks} />}
      />
    );
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
  const stored = Object.values(states).flatMap((state) => (state ? [state] : []));
  const streakDays = <StreakDays streak={streak} week={week} done={total === 0} />;

  if (total === 0) {
    const studied = new Set(answers.map((answer) => answer.cardId)).size;
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
        mascot="sleepy"
        words={
          <>
            <Figure>다 했어요</Figure>
            {/* The cards done today, or, where none was due, the next review. */}
            <Line>
              {studied > 0
                ? `${String(studied)}장`
                : next && nextDay
                  ? `다음 복습은 ${nextDay} · ${String(next.cards)}장, 약 ${String(sessionMinutes(next.cards, 0, pace))}분`
                  : "앞으로 7일 동안 복습할 카드가 없어요"}
            </Line>
          </>
        }
        ground={streakDays}
        actions={<EnterLink href={href} label="학습하기" variant="secondary" />}
      />
    );
  }

  return (
    <Home
      initial={initial}
      mascot="thinking"
      words={
        count.backlog ? (
          <>
            <Title>다시 시작하면 돼요</Title>
            <Line>밀린 복습 {total}장을 급한 것부터 해요. 새 카드는 잠시 쉬어요.</Line>
          </>
        ) : (
          <>
            <Figure>{total}장</Figure>
            <Line id="hero-time">
              약 {sessionMinutes(count.review, count.fresh, pace)}분이면 끝나요
            </Line>
          </>
        )
      }
      ground={streakDays}
      actions={<EnterLink href={href} label="시작" />}
    />
  );
}

/** The sky's heading in the title's size. */
function Title({ children }: { children: ReactNode }) {
  return (
    <h2 id="hero-title" className="text-title break-keep">
      {children}
    </h2>
  );
}

/** The sky's heading: "오늘" over a large figure, today's count or that the day is done. */
function Figure({ children }: { children: ReactNode }) {
  return (
    <h2 id="hero-title" className="flex flex-col items-center">
      <span className="text-label">오늘</span>{" "}
      <span className="font-display text-hero-figure tabular-nums break-keep">{children}</span>
    </h2>
  );
}

/** The sky's line under its heading. */
function Line({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="text-body-strong break-keep">
      {children}
    </p>
  );
}

/**
 * With notes but no card, the one way to cards: with one note, "카드 추가", which opens it with its
 * 카드 추가 sheet up; with several, "노트에서 카드 추가", which opens the 노트 page (ADR 0165).
 */
function AddCards({ decks }: { decks: Deck[] }) {
  const [only] = decks;
  return (
    <Link
      href={
        decks.length === 1 && only ? `/decks/${encodeURIComponent(only.id)}?adding=1` : "/decks"
      }
      className={`${buttonClass("primary", "cta")} w-full`}
    >
      {decks.length === 1 ? "카드 추가" : "노트에서 카드 추가"}
    </Link>
  );
}

/** The hill at the sky's foot: the ground rising to a crest at its centre, a quadratic curve. */
function Hill() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      className="absolute inset-x-0 bottom-0 h-8 w-full fill-ground"
    >
      {/* A quadratic's peak is half its control point's height. */}
      <path d="M0 32Q50-32 100 32Z" />
    </svg>
  );
}

/**
 * 홈's one screen (`home-frame.ts`): the sky, under "알아몰라" and, below 1024 px, the profile
 * button with the account's [initial], holding [words] over the hill, the [mascot] in that
 * expression on its crest, the link to 말랑이's chat with what it has ready beside it; on the
 * ground [ground], the streak or why the day cannot be read, centred over the [actions].
 */
function Home({
  initial,
  mascot,
  words,
  ground,
  actions,
}: {
  initial: string | null;
  mascot: MascotExpression;
  words: ReactNode;
  ground?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className={homeFrame}>
      <SkyThemeColor />
      <section aria-labelledby="hero-title" className={homeSky}>
        <div className="flex items-center justify-between gap-3 lg:sr-only">
          <h1 className="text-title">알아몰라</h1>
          <span className="lg:hidden">
            <ProfileButton initial={initial} onHero />
          </span>
        </div>
        <div className={homeWords}>{words}</div>
        <Hill />
        <div className={homeMascotRoom}>
          {/* The mascot is 말랑이, the assistant's entry on 홈 (#722), its bubble over its head. */}
          <Link
            href="/assistant"
            className={`${homeMascot} rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-hero`}
          >
            <span className="sr-only">말랑이와 대화하기</span>
            <Mascot expression={mascot} className="size-full" />
            <ReadyBubble className="absolute bottom-full left-1/2 mb-1 w-max -translate-x-1/2 rounded-row bg-surface px-3 py-2 text-secondary break-keep text-ink" />
          </Link>
        </div>
      </section>
      <div className={homeGround}>
        <div className="flex flex-1 items-center justify-center">{ground}</div>
        {actions}
      </div>
    </div>
  );
}
