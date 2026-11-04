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
  size: "size-mascot-medium";
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
