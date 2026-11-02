import Link from "next/link";

import { AuthoringButton } from "./authoring-button";
import type { Deck } from "../library";

import { Mascot, type MascotExpression } from "@/design/brand";

/**
 * The first run's layout: the one sentence [title] as a heading, under the mascot in its [mascot]
 * expression, as large as [size] says.
 */
function FirstRun({
  id,
  title,
  mascot,
  size,
}: {
  id: string;
  title: string;
  mascot: MascotExpression;
  size: "size-mascot-large" | "size-mascot-medium";
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col items-center gap-2 pt-10 text-center">
      <Mascot expression={mascot} className={`mb-4 ${size}`} />
      <h2 id={id} className="text-body-strong break-keep">
        {title}
      </h2>
    </section>
  );
}

/**
 * The home page of a user with no deck, as the phone's first run draws it: the mascot, the
 * invitation, and where decks are made, with its creation action.
 */
export function EmptyHome() {
  return (
    <>
      <FirstRun
        id="empty-home-title"
        title="첫 노트를 만들어 볼까요?"
        mascot="thinking"
        size="size-mascot-large"
      />
      <AuthoringButton primary />
    </>
  );
}

/**
 * A deck's page while the deck holds no card, in the first run's layout under the sleepy mascot,
 * with the phone's words for an empty deck, and where cards are added, with the page’s creation
 * action.
 */
export function EmptyDeck() {
  return (
    <FirstRun
      id="empty-deck-title"
      title="아직 카드가 없어요"
      mascot="sleepy"
      size="size-mascot-medium"
    />
  );
}

/**
 * The 오늘 page of a user whose decks hold no card, as the phone's 오늘 tab draws it, the mascot
 * glad of the deck just made: how to start rather than a finished day, and the one way there:
 * adding a card to the one deck, or, with several, the deck list.
 */
export function NoCardsHome({ decks }: { decks: Deck[] }) {
  return (
    <>
      <FirstRun
        id="no-cards-title"
        title="첫 카드를 만들어 볼까요?"
        mascot="happy"
        size="size-mascot-large"
      />
      {decks.length === 1 && decks[0] ? (
        <AuthoringButton deck={decks[0]} primary />
      ) : (
        <Link
          href="/decks"
          className="pressable flex min-h-cta items-center justify-center rounded-button bg-primary px-5 text-button text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          노트에서 카드 추가
        </Link>
      )}
    </>
  );
}
