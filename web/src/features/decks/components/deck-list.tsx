"use client";

import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Chip } from "@/design/chip";

import type { Deck } from "../library";
import { DeckTile } from "./deck-tile";

/**
 * A deck as its row shows it: its card count, what a session over it would study now, and how
 * many of its cards are mastered (익힘) and learning (학습 중).
 */
export type DeckRow = {
  deck: Deck;
  cards: number;
  today: number;
  mastered: number;
  learning: number;
};

/**
 * The decks under a search that keeps those whose name holds it, ignoring case; each a row that
 * opens the deck: its tile, its name, "n장 중 m장 익힘" under it and its progress bar under that,
 * or "0장" and no bar for a deck with no card, "공개" when it is published, today's chip, and a
 * chevron (ADR 0096). The row's name ends with the bar's mastered, learning and new counts, the
 * one place a screen reader hears the learning cards.
 */
export function DeckList({ rows }: { rows: DeckRow[] }) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLocaleLowerCase();
  const shown = needle
    ? rows.filter((row) => row.deck.name.toLocaleLowerCase().includes(needle))
    : rows;
  return (
    <section aria-label="덱 목록" className="flex flex-col gap-3">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted"
          strokeWidth={2}
        />
        <input
          type="search"
          aria-label="덱 검색"
          placeholder="덱 검색"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          className="h-search w-full rounded-field border border-outline bg-surface pr-4 pl-12 text-body placeholder:text-muted focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ink"
        />
      </div>
      {shown.length === 0 ? (
        <p role="status" className="text-muted">
          찾는 덱이 없어요. 다른 단어로 검색해 보세요.
        </p>
      ) : (
        <ul className="grid gap-row-gap lg:grid-cols-2">
          {shown.map(({ deck, cards, today, mastered, learning }) => (
            <li key={deck.id}>
              <Link
                href={`/decks/${encodeURIComponent(deck.id)}`}
                aria-label={`${deck.name}, 카드 ${String(cards)}장${deck.public ? ", 공개" : ""}${today > 0 ? `, 오늘 ${String(today)}` : ""}${cards > 0 ? `, ${String(cards)}장 중 ${String(mastered)}장 익힘, 익힘 ${String(mastered)}장, 학습 중 ${String(learning)}장, 새 카드 ${String(cards - mastered - learning)}장` : ""}`}
                className="pressable flex min-h-13 items-center gap-3 rounded-row bg-surface py-3 pr-3 pl-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                <DeckTile deck={deck} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-body-strong">{deck.name}</span>
                  <span className="text-caption text-muted">
                    {cards > 0 ? `${String(cards)}장 중 ${String(mastered)}장 익힘` : "0장"}
                  </span>
                  {/* A deck with no card has no share to draw. */}
                  {cards > 0 && (
                    <span
                      aria-hidden
                      className="flex h-1.5 overflow-hidden rounded-full bg-edge"
                    >
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
                {today > 0 && <Chip tone="brand">오늘 {today}</Chip>}
                <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" strokeWidth={2} />
              </Link>
            </li>
          ))}
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
