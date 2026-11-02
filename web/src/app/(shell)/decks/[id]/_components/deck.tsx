import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AuthoringButton,
  CardGrid,
  DeckTile,
  type LibraryFailure,
  parseDeckId,
  ReadFailure,
} from "@/features/decks";
import {
  countDay,
  dayPlanOf,
  deckProgress,
  readToday,
  readyServerEngine,
  sessionMinutes,
  studyHref,
} from "@/features/study";

import { EnterLink } from "../../../_components/enter-link";
import { readDeck } from "./read-deck";

/**
 * The deck [params] names, read on the server, as the phone's deck screen draws it (ADR 0118):
 * the way back, its tile and name over the page's one count of its cards, the white card "오늘
 * 학습" while it holds any, and its cards. A deck that does not exist, or an id that names none,
 * is not found.
 */
export async function Deck({ params }: { params: Promise<{ id: string }> }) {
  const deckId = parseDeckId((await params).id);
  if (!deckId) notFound();
  const [read, studyDay] = await Promise.all([readDeck(deckId), readToday()]);
  if ("failure" in read) return <Failure failure={read.failure} />;
  if ("failure" in studyDay) return <Failure failure={studyDay.failure} />;

  const deck = read.library.decks.find((candidate) => candidate.id === deckId);
  if (!deck) notFound();
  const { cards } = read.library;
  const { states, day, pace, answers } = studyDay.today;
  const engine = await readyServerEngine();
  if ("failure" in engine) return <Failure failure={engine.failure} />;
  const today = countDay(dayPlanOf(cards, states, day, answers), states);
  const total = today.review + today.fresh;
  const { mastered } = deckProgress(cards, states);
  return (
    <>
      <nav aria-label="위치" className="text-secondary">
        <BackToDecks />
      </nav>
      <header className="flex items-center gap-3.5">
        <DeckTile deck={deck} size="size-13 lg:rounded-button" />
        <div className="flex min-w-0 flex-col">
          <h1 className="text-deck-name break-words">{deck.name}</h1>
          {/* The page's one count of its cards. */}
          <p className="text-secondary text-muted">
            {[
              `카드 ${String(cards.length)}장`,
              ...(cards.length > 0 ? [`익힌 카드 ${String(mastered)}장`] : []),
              ...(deck.public ? ["공개"] : []),
            ].join(" · ")}
          </p>
        </div>
      </header>
      {/* A deck with no card has nothing to study, and no count of zeros above its empty line. */}
      {cards.length > 0 && (
        <section
          aria-labelledby="deck-today-title"
          className="flex flex-col gap-4 rounded-card bg-surface p-5 text-ink shadow-card lg:p-6"
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-secondary text-muted">
              <h2 id="deck-today-title">오늘 학습</h2>
              <span>약 {sessionMinutes(today.review, today.fresh, pace)}분</span>
            </div>
            <p aria-label={`오늘 할 카드 ${String(total)}장`}>
              <span className="text-figure tabular-nums">{total}</span>
              <span className="text-headline text-muted">장</span>
            </p>
            {today.backlog && (
              <p className="text-secondary text-muted">밀린 복습을 마칠 때까지 새 카드는 쉬어요.</p>
            )}
          </div>
          {/* A row, so the link keeps its row sizes inside the card's column. */}
          <div className="flex flex-wrap">
            <EnterLink href={studyHref([deck.id], "deck")} label="학습하기" />
          </div>
        </section>
      )}
      <CardGrid deck={deck} cards={cards} />
      <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom))] z-[2] bg-ground py-3 lg:bottom-0">
        <AuthoringButton deck={deck} primary={cards.length === 0} />
      </div>
    </>
  );
}

/** The way back to the deck list. */
function BackToDecks() {
  return (
    <Link
      href="/decks"
      className="flex min-h-tap-target min-w-tap-target items-center w-fit gap-1 rounded-md pr-2 text-muted underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <ChevronLeft aria-hidden className="size-5" strokeWidth={2} />
      노트
    </Link>
  );
}

/** A failed read under the way back to 노트 and a heading saying the deck could not be read. */
function Failure({ failure }: { failure: LibraryFailure }) {
  return (
    <>
      <nav aria-label="위치" className="text-secondary">
        <BackToDecks />
      </nav>
      <h1 className="text-deck-title lg:text-display">노트를 불러오지 못했어요</h1>
      <ReadFailure failure={failure} />
    </>
  );
}
