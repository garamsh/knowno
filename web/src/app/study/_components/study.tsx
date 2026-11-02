import Link from "next/link";
import { notFound } from "next/navigation";

import {
  audioLength,
  audioOf,
  type Content,
  describeContent,
  holdsBlank,
  type LibraryFailure,
  ReadFailure,
  readLibrary,
  SideText,
  spokenCells,
  WholeCells,
} from "@/features/decks";
import {
  type CardStates,
  dayPlanOf,
  newCards,
  readToday,
  readyServerEngine,
  studyDecks,
  StudyScreen,
  studyReturn,
} from "@/features/study";

import { StudySkeleton } from "./study-skeleton";

/**
 * Opens a session over the decks [searchParams] names: reads their cards, their states and
 * today's answers on the server and selects the cards left today, through today's list, and the
 * new cards past them.
 * Decks that do not exist, and ids that name no deck, are left out; with none left, the page is
 * not found.
 */
export async function Study({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { decks, from } = await searchParams;
  const named = studyDecks(decks);
  if (named.length === 0) notFound();
  const back = studyReturn(from, named);
  const [read, today] = await Promise.all([readLibrary(named), readToday({ streak: true })]);
  if ("failure" in read) return <Failure failure={read.failure} back={back} />;
  if ("failure" in today) return <Failure failure={today.failure} back={back} />;
  if (!read.library.decks.some((deck) => named.includes(deck.id))) notFound();

  // Each sound plays from the address the read signed (ADR 0112, ADR 0163).
  const sounds = (blocks: Content[]) =>
    audioOf(blocks).map((sound) => ({
      media: sound.media,
      length: audioLength(sound.durationMs),
      url: sound.url ?? null,
    }));

  // Each side's text, and a whole card's faces, for the client, which cannot import decks' entry
  // point.
  const cards = read.library.cards.map(({ cells, ...card }) => ({
    ...card,
    text: {
      front: describeContent(card.front),
      back: holdsBlank(cells) ? spokenCells(cells, true) : describeContent(card.back),
    },
    ...(holdsBlank(cells) && {
      whole: {
        spokenFront: spokenCells(cells, false),
        empty: <WholeCells cells={cells} revealed={false} />,
        filled: <WholeCells cells={cells} revealed />,
      },
    }),
    // A senses block's labels and a photo with no box are drawn as decks draws a side.
    ...([...card.front, ...card.back].some(
      (block) => block.kind === "senses" || block.kind === "image",
    ) && {
      sides: {
        front: <SideText blocks={card.front} photos />,
        back: <SideText blocks={card.back} photos />,
      },
    }),
    ...(audioOf([...card.front, ...card.back]).length > 0 && {
      sounds: { front: sounds(card.front), back: sounds(card.back) },
    }),
  }));
  const { day, answers, states, readAt, pace, streakBefore } = today.today;
  const ids = new Set(cards.map((card) => card.id));
  const own = answers.filter((answer) => ids.has(answer.cardId));
  // Today's list keeps a card answered "모른다" last today, which its state no longer makes due.
  const engine = await readyServerEngine();
  if ("failure" in engine) return <Failure failure={engine.failure} back={back} />;
  const plan = dayPlanOf(cards, states, day, own);
  const taken = new Set([...plan.selected.cards, ...plan.relearn].map((card) => card.id));
  const more = newCards(cards, states).filter((card) => !taken.has(card.id));
  // The day's last answer, shown in the previous card's place until the session's first.
  const last = own.reduce<(typeof own)[number] | undefined>(
    (latest, answer) => (latest && latest.reviewedAt > answer.reviewedAt ? latest : answer),
    undefined,
  );
  const lastCard = last && cards.find((card) => card.id === last.cardId);
  // The state of every card the session may write, and of every card answered today, which the
  // session's count reads.
  const before: CardStates = {};
  for (const id of [...taken, ...own.map((answer) => answer.cardId)]) {
    const state = states[id];
    if (state) before[id] = state;
  }
  return (
    <StudyScreen
      back={back}
      loading={<StudySkeleton />}
      plan={{
        startedAt: readAt,
        day: { start: day.start, end: day.end },
        queue: plan.selected,
        relearn: plan.relearn,
        resumed: plan.done.size > 0,
        earlier: last && lastCard ? { card: lastCard, answer: last.answer } : null,
        more,
        extra: [...plan.extra],
        before,
        pace,
        today: {
          answers: own.map(({ cardId, answer, reviewedAt, durationMs }) => ({
            cardId,
            answer,
            reviewedAt,
            durationMs,
          })),
          answeredAnyDeck: answers.length > 0,
          streakBefore,
        },
      }}
    />
  );
}

/**
 * The decks' read failure, with "그만하기" to [back], where the session was opened from, since no
 * shell surrounds the page.
 */
function Failure({ failure, back }: { failure: LibraryFailure; back: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 px-gutter py-6">
      <ReadFailure failure={failure} />
      <Link
        href={back}
        className="pressable flex min-h-button items-center justify-center self-start rounded-button bg-surface px-5 text-button text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        그만하기
      </Link>
    </main>
  );
}
