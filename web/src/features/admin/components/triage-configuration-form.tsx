"use client";

import { useActionState } from "react";

import type { AiFormState } from "../ai-settings";
import { providerLabels } from "../labels";
import { saveTriageConfiguration } from "../save-triage-configuration";
import { button, field, formInput, formLine, group } from "./admin-section";

const input = `${field} ${formInput}`;

/** What a tier of the form starts from. */
export type TierStart = { provider: string; model: string; inUsd: number; outUsd: number };

function Tier({
  prefix,
  name,
  start,
}: {
  prefix: "cheap" | "strong";
  name: string;
  start: TierStart;
}) {
  return (
    <div className={group}>
      <label className={formLine}>
        <span className="text-body">{name} 제공자</span>
        <select name={`${prefix}_provider`} defaultValue={start.provider} className={input}>
          {Object.entries(providerLabels).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className={formLine}>
        <span className="shrink-0 text-body">{name} 모델</span>
        <input
          name={`${prefix}_model`}
          defaultValue={start.model}
          required
          className={`${input} flex-1`}
        />
      </label>
      <label className={formLine}>
        <span className="shrink-0 text-body">{name} 입력 (달러/백만 토큰)</span>
        <input
          type="number"
          name={`${prefix}_in_usd`}
          min={0}
          max={1000}
          step="any"
          required
          defaultValue={start.inUsd}
          className={`${input} w-28`}
        />
      </label>
      <label className={formLine}>
        <span className="shrink-0 text-body">{name} 출력 (달러/백만 토큰)</span>
        <input
          type="number"
          name={`${prefix}_out_usd`}
          min={0}
          max={1000}
          step="any"
          required
          defaultValue={start.outUsd}
          className={`${input} w-28`}
        />
      </label>
    </div>
  );
}

/**
 * The triage's new configuration, its cheap and strong tier, prompt and limits, saved as its one
 * draft only after one call per tier with the provider's key parsed (ADR 0244); the draft is not
 * used until 적용, so its button is outlined.
 */
export function TriageConfigurationForm({
  start,
}: {
  start: {
    cheap: TierStart;
    strong: TierStart;
    prompt: string;
    escalateBelow: number;
    payloadTokens: number;
    sampleCards: number;
  };
}) {
  const [state, action, pending] = useActionState<AiFormState, FormData>(saveTriageConfiguration, {
    message: null,
    reauth: false,
  });
  return (
    <form action={action} aria-label="신고 AI 새 초안" className="flex flex-col gap-2">
      <Tier prefix="cheap" name="먼저 보는 모델" start={start.cheap} />
      <Tier prefix="strong" name="다시 보는 모델" start={start.strong} />
      <div className={group}>
        <label className={formLine}>
          <span className="shrink-0 text-body">다시 보는 확신 기준</span>
          <input
            type="number"
            name="escalate_below"
            min={0}
            max={1}
            step={0.01}
            required
            defaultValue={start.escalateBelow}
            className={`${input} w-24`}
          />
        </label>
        <label className={formLine}>
          <span className="shrink-0 text-body">글 길이 (토큰)</span>
          <input
            type="number"
            name="payload_tokens"
            min={500}
            max={20000}
            step={1}
            required
            defaultValue={start.payloadTokens}
            className={`${input} w-24`}
          />
        </label>
        <label className={formLine}>
          <span className="shrink-0 text-body">살펴볼 카드 수</span>
          <input
            type="number"
            name="sample_cards"
            min={0}
            max={50}
            step={1}
            required
            defaultValue={start.sampleCards}
            className={`${input} w-24`}
          />
        </label>
        <label className="flex flex-col gap-2 px-4 py-3">
          <span className="text-body">프롬프트</span>
          <textarea
            name="prompt"
            defaultValue={start.prompt}
            required
            maxLength={8000}
            rows={8}
            className={`${field} w-full resize-y`}
          />
        </label>
      </div>
      <button type="submit" disabled={pending} className={`${button.secondary} self-start`}>
        {pending ? "확인하는 중…" : "확인하고 초안으로 저장"}
      </button>
      <p role="status" className="text-caption text-muted empty:hidden">
        {state.message}
      </p>
    </form>
  );
}
