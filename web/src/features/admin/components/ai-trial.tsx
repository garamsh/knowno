"use client";

import { useId, useState, useTransition } from "react";

import { encodePhoto } from "../encode-photo";
import type { TrialResult } from "../trial";
import { type ComparedTrial, tryAiConfiguration } from "../try-ai-configuration";
import { button } from "./admin-section";

function Result({ title, result }: { title: string; result: TrialResult }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2">
      <h4 className="text-body-strong text-ink-2">{title}</h4>
      {"message" in result ? (
        <p className="text-caption text-muted">{result.message}</p>
      ) : (
        <>
          <p className="text-caption text-muted">카드 {String(result.cards.length)}장</p>
          <ul className="flex flex-col divide-y divide-hairline">
            {result.cards.map((made, index) => (
              <li key={index} className="flex flex-col gap-1 py-2">
                <span className="text-body-strong">{made.front}</span>
                <span className="text-body whitespace-pre-wrap">{made.back}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * 사진 한 장으로 시험 for a plan's draft (ADR 0162): one photo read by the draft and by the active
 * configuration at once, as the signed-in admin, each with the prompt [prompt] names, side by side.
 */
export function AiTrial({
  name,
  draftId,
  activeId,
  prompt,
}: {
  name: string;
  draftId: number;
  activeId: number;
  prompt: string;
}) {
  const [compared, setCompared] = useState<ComparedTrial | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();
  return (
    <section aria-label={`${name} 사진 한 장으로 시험`} className="flex flex-col gap-2 px-4 py-3">
      <h3 className="text-body-strong">사진 한 장으로 시험</h3>
      <p className="text-caption text-ink-2">
        같은 사진을 테스트 설정과 사용 중 설정으로 읽어 나란히 보여 줘요. 프롬프트는 {prompt}예요.
        사진마다 1장으로 기록돼요.
      </p>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const input = event.currentTarget.elements.namedItem("photo");
          const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
          if (file === undefined) return;
          setMessage(null);
          setCompared(null);
          startTransition(async () => {
            const photo = await encodePhoto(file);
            if (photo === null) {
              setMessage("이 사진을 읽지 못했어요. 다른 사진을 골라 주세요.");
              return;
            }
            const form = new FormData();
            form.set("photo", photo);
            setCompared(await tryAiConfiguration(draftId, activeId, form));
          });
        }}
      >
        <label htmlFor={id} className="sr-only">
          사진
        </label>
        <input
          id={id}
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="min-w-0 text-caption text-ink-2 file:mr-3 file:rounded-button file:border file:border-outline file:bg-surface file:px-3 file:py-2 file:text-body file:text-ink"
        />
        <button type="submit" disabled={pending} className={`${button.row} self-start`}>
          {pending ? "읽는 중…" : "시험하기"}
        </button>
      </form>
      <p role="status" className="text-caption text-muted empty:hidden">
        {message ?? (compared !== null && "message" in compared ? compared.message : null)}
      </p>
      {compared !== null && !("message" in compared) && (
        <div className="grid gap-4 md:grid-cols-2">
          <Result title="테스트 설정" result={compared.draft} />
          <Result title="사용 중 설정" result={compared.active} />
        </div>
      )}
    </section>
  );
}
