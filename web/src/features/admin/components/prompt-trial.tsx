"use client";

import { useState } from "react";

import type { TrialCard } from "../trial";
import { tryPrompt } from "../try-prompt";
import { card } from "./admin-section";
import { PhotoForm, TrialCards } from "./photo-trial";

/**
 * Runs extract-cards on one photo as the signed-in admin, who is served [served]: the test version
 * when one is set, else the active one. No limit applies to an admin; the photo is still counted.
 */
export function PromptTrial({ served }: { served: { id: number; test: boolean } }) {
  const [cards, setCards] = useState<TrialCard[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <section aria-label="사진 한 장으로 시험" className={card}>
      <h2 className="text-body-strong text-ink-2">사진 한 장으로 시험</h2>
      <p className="text-caption text-ink-2">
        {served.test ? "테스트" : "사용 중인"} 버전 {served.id}로 카드를 만들어요. 관리자는 한도
        없이 쓰고, 사진 1장으로 기록돼요.
      </p>
      <PhotoForm
        pendingLabel="만드는 중…"
        reset={() => {
          setMessage(null);
          setCards(null);
        }}
        read={async (photo) => {
          const result = await tryPrompt(photo);
          if ("message" in result) setMessage(result.message);
          else setCards(result.cards);
        }}
        fail={setMessage}
      />
      <p role="status" className="text-caption text-muted empty:hidden">
        {message ?? (cards === null ? null : `카드 ${String(cards.length)}장을 만들었어요.`)}
      </p>
      {cards !== null && <TrialCards cards={cards} label="만든 카드" />}
    </section>
  );
}
