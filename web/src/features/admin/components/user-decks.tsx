import Link from "next/link";

import { Chip } from "@/design/chip";

import type { UserDeck } from "../read-admin";
import { AdminSection, Empty, group } from "./admin-section";
import { DeckStateChips } from "./deck-state";

/** Every live deck of a user, public or private, each opening the deck read-only. */
export function UserDecks({ decks }: { decks: UserDeck[] }) {
  return (
    <AdminSection label="노트">
      {decks.length === 0 ? (
        <Empty>노트가 없어요. 이 사용자가 노트를 만들면 여기에 보여요.</Empty>
      ) : (
        <ul className={`${group} overflow-hidden`}>
          {decks.map((deck) => (
            <li key={deck.id}>
              <Link
                href={`/admin/decks/${deck.id}`}
                className="pressable flex min-h-13 items-center justify-between gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-body-strong">{deck.name}</span>
                  <DeckStateChips
                    state={{ visibility: deck.visibility, hidden: deck.hidden, deleted: false }}
                  />
                  {deck.removed && <Chip tone="amber">공유 삭제</Chip>}
                </span>
                <span className="text-caption whitespace-nowrap text-muted">
                  카드 {deck.cards}장
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AdminSection>
  );
}
