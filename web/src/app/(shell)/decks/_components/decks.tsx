import {
  AuthoringButton,
  DeckList,
  EmptyHome,
  type LibraryFailure,
  ReadFailure,
  readDeckList,
} from "@/features/decks";
import { countDay, dayPlanOf, deckProgress, readyServerEngine, readToday } from "@/features/study";

/** Every deck with what a session over it would study now and its progress, read on the server. */
export async function Decks() {
  const [read, today] = await Promise.all([readDeckList(), readToday()]);
  const failure = (failure: LibraryFailure) => (
    <>
      <h1 className="text-display">내 노트</h1>
      <ReadFailure failure={failure} />
    </>
  );
  if ("failure" in read) return failure(read.failure);
  if ("failure" in today) return failure(today.failure);
  const { decks, cards } = read.library;
  const { day, states, answers } = today.today;
  const heading = (
    <h1 className="text-display">
      내 노트 <span className="text-muted">{decks.length}</span>
    </h1>
  );
  if (decks.length === 0) {
    return (
      <>
        {heading}
        <EmptyHome />
      </>
    );
  }
  const engine = await readyServerEngine();
  if ("failure" in engine) return failure(engine.failure);
  const rows = decks.map((deck) => {
    const own = cards.filter((card) => card.deckId === deck.id);
    const left = countDay(dayPlanOf(own, states, day, answers), states);
    const { mastered, learning } = deckProgress(own, states);
    return { deck, cards: own.length, today: left.review + left.fresh, mastered, learning };
  });
  return (
    <>
      {heading}
      <DeckList rows={rows} />
      <AuthoringButton decks={decks} />
    </>
  );
}
