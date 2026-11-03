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
 * 홈 for a user with no note, under 홈's top bar, as the final screens draw it (ADR 0150): the
 * thinking mascot, the invitation in the title's size, and "새 노트 만들기" in the primary fill,
 * which opens 새 노트.
 */
export function EmptyHome() {
  return (
    <>
      <section
        aria-labelledby="empty-home-title"
        className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center"
      >
        <Mascot expression="thinking" className="size-mascot-large" />
        <h2 id="empty-home-title" className="text-title break-keep">
          첫 노트를 만들어 볼까요?
        </h2>
      </section>
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
 * 홈's hero while no note holds a card, in the hero's colours (ADR 0150): the mascot glad of the
 * note just made, "첫 카드를 만들어 볼까요?" and the one way there: with one note, "카드 추가",
 * which opens it with its 카드 추가 sheet up; with several, "노트에서 카드 추가", which opens the
 * 노트 page (ADR 0165). The mascot takes the hero's fitted row, as the phone's does.
 */
export function NoCardsHome({ decks }: { decks: Deck[] }) {
  const [only] = decks;
  return (
    <>
      <Mascot expression="happy" className="" />
      <h2 id="hero-title" className="text-title break-keep">
        첫 카드를 만들어 볼까요?
      </h2>
      <Link
        href={
          decks.length === 1 && only ? `/decks/${encodeURIComponent(only.id)}?adding=1` : "/decks"
        }
        className="pressable mt-3 flex min-h-cta w-full max-w-56 items-center justify-center rounded-button bg-hero-button px-6 text-button text-on-hero-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-hero"
      >
        {decks.length === 1 ? "카드 추가" : "노트에서 카드 추가"}
      </Link>
    </>
  );
}
