import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { parseDeckId } from "@/features/decks";

import { Deck } from "./_components/deck";
import { DeckSkeleton } from "./_components/deck-skeleton";
import { readDeck } from "./_components/read-deck";

/**
 * The deck's name as the page's title, from the read the page makes; a deck that does not exist
 * is not found, as on the page, and a failed read leaves the title 노트's.
 */
export async function generateMetadata({ params }: PageProps<"/decks/[id]">): Promise<Metadata> {
  const deckId = parseDeckId((await params).id);
  if (!deckId) notFound();
  const read = await readDeck(deckId);
  if ("failure" in read) return { title: "노트 · 알아몰라" };
  const deck = read.library.decks.find((candidate) => candidate.id === deckId);
  if (!deck) notFound();
  return { title: `${deck.name} · 알아몰라` };
}

/**
 * One note: its name, its study link and its cards; `?adding=1`, which 새 노트's "저장하고 카드
 * 추가" opens, opens its 카드 추가 sheet.
 */
export default function DeckPage({ params, searchParams }: PageProps<"/decks/[id]">) {
  return (
    <Suspense fallback={<DeckSkeleton />}>
      <Deck params={params} searchParams={searchParams} />
    </Suspense>
  );
}
