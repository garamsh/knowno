"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";

import { Chip } from "@/design/chip";

import type { Deck } from "../library";
import { DeckTile } from "./deck-tile";

/**
 * A deck as its row shows it: its card count, what a session over it would study now, and how
 * many of its cards are mastered (익힘) and learning (학습 중), unknown while the day cannot be
 * read.
 */
export type DeckRow = {
  deck: Deck;
  cards: number;
  today: number;
  mastered?: number;
  learning?: number;
};

/**
 * 홈's notes (ADR 0150): "내 노트 n", a magnifier, "노트 검색", that opens a search keeping the
 * decks whose name holds it, ignoring case, and [action] beside it; then [notice], and a row per
 * deck that opens it: its tile, its name, "n장 중 m장 익힘" under it and its progress bar under
 * that, or "0장" and no bar for a deck with no card, "공개" when it is published, and what a
 * session over it would study now, in the accent (ADR 0096). The row's name ends with the bar's
 * mastered, learning and new counts, the one place a screen reader hears the learning cards.
 */
export function DeckList({
  rows,
  action,
  notice,
}: {
  rows: DeckRow[];
  action?: ReactNode;
  notice?: ReactNode;
}) {
  const [search, setSearch] = useState<string | null>(null);
  const needle = (search ?? "").trim().toLocaleLowerCase();
  const shown = needle
    ? rows.filter((row) => row.deck.name.toLocaleLowerCase().includes(needle))
    : rows;
  return (
    <section id="notes" aria-labelledby="notes-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="notes-title" className="text-label">
          내 노트 {rows.length}
        </h2>
        <span className="flex items-center gap-2">
          <button
            type="button"
            aria-label="노트 검색"
            aria-expanded={search !== null}
            onClick={() => {
              setSearch(search === null ? "" : null);
            }}
            className="pressable flex size-tap-target shrink-0 items-center justify-center rounded-chip bg-surface text-ink shadow-row focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <Search aria-hidden className="size-5" strokeWidth={2.4} />
          </button>
          {action}
        </span>
      </div>
      {notice}
      {search !== null && (
        <input
          type="search"
          aria-label="노트 검색"
          placeholder="노트 검색"
          autoFocus
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          className="h-search w-full rounded-field border border-outline bg-surface px-4 text-body placeholder:text-muted focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ink"
        />
      )}
      {shown.length === 0 ? (
        <p role="status" className="text-muted">
          찾는 노트가 없어요. 다른 단어로 검색해 보세요.
        </p>
      ) : (
        <ul className="grid gap-row-gap lg:grid-cols-2">
          {shown.map((row) => {
            const { deck, cards, today, mastered = 0, learning = 0 } = row;
            // A deck with no card, or whose progress is unknown, has no share to draw.
            const known = cards > 0 && row.mastered !== undefined;
            return (
              <li key={deck.id}>
                <Link
                  href={`/decks/${encodeURIComponent(deck.id)}`}
                  aria-label={`${deck.name}, 카드 ${String(cards)}장${deck.public ? ", 공개" : ""}${today > 0 ? `, 오늘 ${String(today)}` : ""}${known ? `, ${String(cards)}장 중 ${String(mastered)}장 익힘, 익힘 ${String(mastered)}장, 학습 중 ${String(learning)}장, 새 카드 ${String(cards - mastered - learning)}장` : ""}`}
                  className="pressable flex min-h-13 items-center gap-3 rounded-row bg-surface py-3 pr-4 pl-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  <DeckTile deck={deck} />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-body-strong">{deck.name}</span>
                    <span className="text-caption text-muted">
                      {known
                        ? `${String(cards)}장 중 ${String(mastered)}장 익힘`
                        : `${String(cards)}장`}
                    </span>
                    {known && (
                      <span aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-edge">
                        <span
                          className="bg-accent"
                          style={{ width: `${String(share(mastered, cards))}%` }}
                        />
                        <span
                          className="bg-chart-quiet"
                          style={{ width: `${String(share(learning, cards))}%` }}
                        />
                      </span>
                    )}
                  </span>
                  {deck.public && <PublicChip />}
                  {today > 0 && (
                    <span aria-hidden className="shrink-0 text-label text-accent tabular-nums">
                      {today}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** [part] of a non-empty [whole], in percent. */
function share(part: number, whole: number): number {
  return (part / whole) * 100;
}

/** The chip beside a deck its owner published, as the phone draws it. */
export function PublicChip() {
  return <Chip>공개</Chip>;
}
