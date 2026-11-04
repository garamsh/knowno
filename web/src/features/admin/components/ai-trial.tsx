"use client";

import { useState } from "react";

import type { TrialResult } from "../trial";
import { type ComparedTrial, tryAiConfiguration } from "../try-ai-configuration";
import { PhotoForm, TrialCards } from "./photo-trial";

function Result({ title, result }: { title: string; result: TrialResult }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2">
      <h4 className="text-body-strong text-ink-2">
        {"message" in result ? title : `${title} · 카드 ${String(result.cards.length)}장`}
      </h4>
      {"message" in result ? (
        <p className="text-caption text-muted">{result.message}</p>
      ) : (
        <TrialCards cards={result.cards} />
      )}
    </section>
  );
}

/**
 * 사진 한 장으로 시험 for a plan's draft (ADR 0162): one photo read by the active configuration and
 * by the draft at once, as the signed-in admin, each with its own prompt, side by side.
 */
export function AiTrial({
  name,
  draftId,
  activeId,
}: {
  name: string;
  draftId: number;
  activeId: number;
}) {
  const [compared, setCompared] = useState<ComparedTrial | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <section aria-label={`${name} 사진 한 장으로 시험`} className="flex flex-col gap-2 px-4 py-3">
      <h3 className="text-body-strong">사진 한 장으로 시험</h3>
      <p className="text-caption text-ink-2">
        같은 사진을 지금 구성과 초안으로 읽어 나란히 보여 줘요. 사진마다 1장으로 기록돼요.
      </p>
      <PhotoForm
        pendingLabel="읽는 중…"
        reset={() => {
          setMessage(null);
          setCompared(null);
        }}
        read={async (photo) => {
          setCompared(await tryAiConfiguration(draftId, activeId, photo));
        }}
        fail={setMessage}
      />
      <p role="status" className="text-caption text-muted empty:hidden">
        {message ?? (compared !== null && "message" in compared ? compared.message : null)}
      </p>
      {compared !== null && !("message" in compared) && (
        <div className="grid gap-4 md:grid-cols-2">
          <Result title="지금 구성" result={compared.active} />
          <Result title="초안" result={compared.draft} />
        </div>
      )}
    </section>
  );
}
