import { ScreenSkeleton } from "@/design/screen-skeleton";
import { DeckList, NotesMenu, ReadFailure, readDeckList } from "@/features/decks";
import { countDay, dayPlanOf, deckProgress, readToday, readyServerEngine } from "@/features/study";

/**
 * The 노트 page, read on the server, as the phone's 노트 tab (ADR 0165): "노트" with "+ 새 노트" and its ⋯,
 * then the notes under their search field, each row carrying the note's count for today and its
 * progress. A day that cannot be counted leaves the rows their card counts and puts why above
 * them; a failed read of the notes says why under the title.
 */
export async function Notes() {
  const [read, today] = await Promise.all([readDeckList(), readToday()]);
  const actions = <NotesMenu />;
  if ("failure" in read) {
    return (
      <ScreenSkeleton title="노트" topLevel actions={actions}>
        <ReadFailure failure={read.failure} />
      </ScreenSkeleton>
    );
  }
  const { decks, cards } = read.library;
  const uncounted = decks.map((deck) => ({
    deck,
    cards: cards.filter((card) => card.deckId === deck.id).length,
    today: 0,
  }));
  if ("failure" in today) {
    return (
      <DeckList
        rows={uncounted}
        notice={<ReadFailure failure={today.failure} />}
        actions={actions}
      />
    );
  }
  // Today's list places the cards, as the study page and 홈 do, so the counts agree.
  const engine = await readyServerEngine();
  if ("failure" in engine) {
    return (
      <DeckList
        rows={uncounted}
        notice={<ReadFailure failure={engine.failure} />}
        actions={actions}
      />
    );
  }
  const { day, states, answers } = today.today;
  const rows = decks.map((deck) => {
    const own = cards.filter((card) => card.deckId === deck.id);
    const left = countDay(dayPlanOf(own, states, day, answers), states);
    const { mastered, learning } = deckProgress(own, states);
    return { deck, cards: own.length, today: left.review + left.fresh, mastered, learning };
  });
  return <DeckList rows={rows} actions={actions} />;
}
