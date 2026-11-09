import { notFound } from "next/navigation";

import { ScreenSkeleton } from "@/design/screen-skeleton";
import { EdgeAssistant } from "@/features/assistant";
import {
  CardGrid,
  type LibraryFailure,
  NoteSettings,
  parseDeckId,
  ReadFailure,
  readDisplayName,
} from "@/features/decks";
import {
  countDay,
  dayPlanOf,
  deckProgress,
  readToday,
  readyServerEngine,
  studyHref,
} from "@/features/study";

import { EnterLink } from "../../../_components/enter-link";
import { readDeck } from "./read-deck";

/**
 * The note [params] names, read on the server, as the final screens draw it (ADR 0150): its name
 * with 노트 설정, whose "직접 추가" opens the 카드 추가 sheet, open on arrival when [searchParams]
 * hold `adding=1`, then the card search, "이 노트 학습 · n장" while it holds a card, and its cards. A note that
 * does not exist, or an id that names none, is not found.
 */
export async function Deck({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const deckId = parseDeckId((await params).id);
  const adding = (await searchParams)?.adding === "1";
  if (!deckId) notFound();
  const [read, studyDay, displayName] = await Promise.all([
    readDeck(deckId),
    readToday(),
    readDisplayName(),
  ]);
  if ("failure" in read) return <Failure failure={read.failure} />;
  if ("failure" in studyDay) return <Failure failure={studyDay.failure} />;

  const deck = read.library.decks.find((candidate) => candidate.id === deckId);
  if (!deck) notFound();
  const { cards } = read.library;
  const { states, day, answers } = studyDay.today;
  const engine = await readyServerEngine();
  if ("failure" in engine) return <Failure failure={engine.failure} />;
  const today = countDay(dayPlanOf(cards, states, day, answers), states);
  const { mastered } = deckProgress(cards, states);
  return (
    <>
      <CardGrid
        deck={deck}
        cards={cards}
        mastered={mastered}
        settings={
          <NoteSettings
            deck={deck}
            cardCount={cards.length}
            cards={cards}
            displayName={displayName}
            adding={adding}
          />
        }
        study={
          <EnterLink
            href={studyHref([deck.id], "deck")}
            label={`이 노트 학습 · ${String(today.review + today.fresh)}장`}
          />
        }
      />
      <EdgeAssistant noteId={deck.id} hint />
    </>
  );
}

/** A failed read under a heading saying the note could not be read. */
function Failure({ failure }: { failure: LibraryFailure }) {
  return (
    <ScreenSkeleton title="노트를 불러오지 못했어요">
      <ReadFailure failure={failure} />
    </ScreenSkeleton>
  );
}
