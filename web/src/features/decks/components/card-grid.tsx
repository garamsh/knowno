"use client";

import { type ReactNode, useId, useState } from "react";

import { describeContent, holdsBlank, spokenCells, spokenContent } from "../card-content";
import type { Card, Deck } from "../library";
import { CardEditor } from "./authoring-button";
import { SideText } from "./side-text";
import { EmptyDeck } from "./empty-home";
import { ListSearch } from "./list-search";
import { WholeCells } from "./whole-card";

/**
 * A note's page, as the final screens draw it (ADR 0150): [add], its "+ 카드 추가", and
 * [settings], its ⋯, over its name, on a line of its own, two lines at most; while it holds a card, the "카드 검색" field, always shown;
 * [study]; then its cards as one group of rows under that search, which keeps the cards whose 칸 hold it, revealed, ignoring case (ADR 0118,
 * ADR 0137). Each row shows its front, and its back muted after it once shown; nothing stands for
 * a hidden back. "뒷면 보기", in a row pinned above the group beside "카드 n" and the [mastered]
 * count, shows or hides every back, starting off each time the page opens. A click on a row opens the card in the editor, as on the phone (ADR 0143). A whole
 * card shows its 칸 in place with its blanks empty, revealed in place where its back shows, and
 * is read the same way.
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
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Card | null>(null);
  const label = useId();
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
      <h1 className="line-clamp-2 text-deck-name break-words">{deck.name}</h1>
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
      <ListSearch label="카드 검색" value={search} change={setSearch} />
      {study}
      <section aria-label="카드" className="flex flex-col gap-3">
        <div className="sticky top-0 z-[1] flex min-h-tap-target flex-wrap items-center justify-between gap-x-3 bg-ground">
          <span className="flex items-baseline gap-2 px-1">
            <h2 className="text-label">카드 {cards.length}</h2>
            <span className="text-secondary text-muted">
              {[`${String(mastered)}장 익힘`, ...(deck.public ? ["공개"] : [])].join(" · ")}
            </span>
          </span>
          <span className="flex items-center gap-3">
            <span id={label} className="text-secondary text-ink-2">
              뒷면 보기
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={open}
              aria-labelledby={label}
              onClick={() => {
                setOpen(!open);
              }}
              className={`pressable relative my-2 h-7 w-12 rounded-full transition-colors before:absolute before:-inset-2 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${open ? "bg-ink" : "bg-outline"}`}
            >
              <span
                aria-hidden
                className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-surface shadow-card transition-transform ${open ? "translate-x-5" : ""}`}
              />
            </button>
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
                  aria-label={open ? `${row.front}, 뒷면 ${row.back}` : `${row.front}, 뒷면 가려짐`}
                  onClick={() => {
                    setEditing(row.card);
                  }}
                  className="pressable flex min-h-cta w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
                >
                  {row.whole ? (
                    <WholeCells cells={row.cells} revealed={open} inRow />
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 text-body-strong break-words">
                        <SideText blocks={row.blocks} />
                      </span>
                      {open && (
                        <span className="min-w-0 flex-1 text-right text-secondary break-words text-muted">
                          <SideText blocks={row.backBlocks} />
                        </span>
                      )}
                    </>
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
