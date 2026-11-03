import Link from "next/link";

import { labelOf, reasonLabels } from "../labels";
import type { AdminDeck } from "../read-admin";
import { removeDeck } from "../remove-deck";
import { formatDate } from "../format";
import { Section } from "@/design/section";
import { Empty, group } from "./admin-section";
import { DeckActions } from "./deck-actions";
import { ReasonAction } from "./reason-action";
import { DeckStateChips } from "./deck-state";

/**
 * A deck, read-only: its owner, state, reports, actions and every live card, and at the end of
 * the page its removal from sharing, the one action that cannot be undone.
 */
export function DeckView({ deck, timeZone }: { deck: AdminDeck; timeZone: string }) {
  return (
    <div className="flex flex-col gap-section-gap">
      <header className="flex flex-col gap-2">
        <h1 className="text-deck-name">{deck.name}</h1>
        <DeckStateChips state={deck.state} />
        <p className="text-caption text-muted">
          <Link
            href={`/admin/users/${deck.owner.id}`}
            className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
          >
            {deck.owner.email}
          </Link>
          {deck.owner.name === null ? "" : ` (${deck.owner.name})`} · 카드 {deck.cards.length}장 ·
          가져오기 {deck.copies}회 · 신고 {deck.reports}건
          {deck.reasons.length === 0
            ? ""
            : ` · ${deck.reasons.map((reason) => labelOf(reasonLabels, reason)).join(", ")}`}
        </p>
        {deck.description !== null && <p className="text-body text-ink-2">{deck.description}</p>}
        {deck.removal !== null && (
          <p role="note" className="text-caption text-ink-2">
            공유에서 영구 삭제됨 · {deck.removal.reason} ·{" "}
            {formatDate(deck.removal.removedAt, timeZone)}
          </p>
        )}
      </header>
      <DeckActions id={deck.id} name={deck.name} state={deck.state} reports={deck.reports} />
      <Section label="카드">
        {deck.cards.length === 0 ? (
          <Empty>카드가 없어요. 주인이 카드를 추가하면 여기에 보여요.</Empty>
        ) : (
          <ul className={group}>
            {deck.cards.map((card) => (
              <li key={card.id} className="grid grid-cols-2 gap-4 px-4 py-3 text-body">
                <span className="break-words">{card.front}</span>
                <span className="break-words text-ink-2">{card.back}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {deck.removal === null && deck.state.visibility === "public" && !deck.state.deleted && (
        <ReasonAction
          label="공유에서 영구 삭제"
          reasonLabel="삭제하는 이유"
          question={`'${deck.name}' 노트를 공유에서 영구 삭제할까요? 노트는 주인에게 남고, 다시 공개할 수 없어요.`}
          confirmLabel="영구 삭제"
          final
          action={removeDeck.bind(null, deck.id)}
        />
      )}
    </div>
  );
}
