"use client";

import { type ReactNode, useState } from "react";

import { describeContent, holdsBlank, spokenCells, spokenContent } from "../card-content";
import type { Card, Deck } from "../library";
import { CardEditor } from "./authoring-button";
import { SideText } from "./side-text";
import { EmptyDeck } from "./empty-home";
import { SearchField } from "@/design/search-field";
import { HatchedBox, ListedCells } from "./whole-card";

/**
 * A note's page, as the final screens draw it (ADR 0150): [add], its "+ 카드 추가", and
 * [settings], its ⋯, over its name, on a line of its own, two lines at most; while it holds a card, the "카드 검색" field, always shown;
 * [study]; then its cards as one group of rows under that search, which keeps the cards whose 칸 hold it, revealed, ignoring case (ADR 0118,
 * ADR 0137), under a row pinned above the group of "카드 n" and the [mastered] count. Each row
 * shows the whole card, and what study hides until the reveal on the hatch (#629): a split card
 * its front cut at two lines and its back after it in a hatched box cut at three, and a whole
 * card its 칸 as `ListedCells` draws them. A click on a row opens the card in the editor, as on
 * the phone (ADR 0143).
 */
export function CardGrid({
  deck,
  cards,
  mastered = 0,
  study,
  add,
  settings,
}: {
  deck: Deck;
  cards: Card[];
  mastered?: number;
  study?: ReactNode;
  add?: ReactNode;
  settings?: ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Card | null>(null);
  const rows = cards.map((card) => {
    const whole = holdsBlank(card.cells);
    return {
      id: card.id,
      card,
      blocks: card.front,
      backBlocks: card.back,
      cells: card.cells,
      front: whole ? spokenCells(card.cells, false) : spokenContent(card.front, false),
      whole,
      faces: [card.front, card.back].map(describeContent),
      back: whole ? spokenCells(card.cells, true) : describeContent(card.back),
    };
  });
  const needle = search.trim().toLocaleLowerCase();
  const shown = needle
    ? rows.filter((row) => row.faces.some((face) => face.toLocaleLowerCase().includes(needle)))
    : rows;

  // The name has a line of its own under the actions, so every name stays readable beside them.
  const header = (
    <header className="flex flex-col gap-2">
      <span className="flex items-center justify-end gap-2">
        {add}
        {settings}
      </span>
      <h1 className="line-clamp-2 text-deck-name break-words break-keep">{deck.name}</h1>
    </header>
  );
  if (cards.length === 0) {
    return (
      <>
        {header}
        <EmptyDeck />
      </>
    );
  }
  return (
    <>
      {header}
      <SearchField
        label="카드 검색"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      {study}
      <section aria-label="카드" className="flex flex-col gap-3">
        <div className="sticky top-(--photo-import-bar,0px) z-[1] flex min-h-tap-target flex-wrap items-center justify-between gap-x-3 bg-ground">
          <span className="flex items-baseline gap-2 px-1">
            <h2 className="text-label">카드 {cards.length}</h2>
            <span className="text-secondary text-muted">
              {[`${String(mastered)}장 익힘`, ...(deck.public ? ["공개"] : [])].join(" · ")}
            </span>
          </span>
        </div>
        {shown.length === 0 ? (
          <p role="status" className="text-muted">
            찾는 카드가 없어요. 다른 단어로 검색해 보세요.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-hairline overflow-hidden rounded-group bg-surface">
            {shown.map((row) => (
              <li key={row.id} className="flex">
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-label={`${row.front}, 뒷면 ${row.back}`}
                  onClick={() => {
                    setEditing(row.card);
                  }}
                  className="pressable flex min-h-cta w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
                >
                  {row.whole ? (
                    <ListedCells cells={row.cells} />
                  ) : (
                    <span className="flex min-w-0 flex-1 flex-col gap-2">
                      <span className="line-clamp-2 text-body-strong break-words break-keep">
                        <SideText blocks={row.blocks} />
                      </span>
                      {row.backBlocks.length > 0 && (
                        <span className="text-secondary break-words text-ink-2">
                          <HatchedBox>
                            <SideText blocks={row.backBlocks} />
                          </HatchedBox>
                        </span>
                      )}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {editing && (
          <CardEditor
            key={editing.id}
            deck={deck}
            card={editing}
            close={() => {
              setEditing(null);
            }}
          />
        )}
      </section>
    </>
  );
}
