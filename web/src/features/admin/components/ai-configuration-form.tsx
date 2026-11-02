"use client";

import { useActionState } from "react";

import type { AiFormState } from "../ai-settings";
import { providerLabels } from "../labels";
import { saveAiConfiguration } from "../save-ai-configuration";
import { button, field, group } from "./admin-section";

const line = "flex min-h-button items-center justify-between gap-3 px-4";
const input = `${field} h-tap-target min-w-0 px-2 text-right`;

/**
 * A plan's new provider and model, saved as its draft only after one call with them parsed (ADR
 * 0162); the draft serves admins until 모두에게 적용. The plans page draws one per plan, so its
 * button is outlined.
 */
export function AiConfigurationForm({
  plan,
  name,
  provider,
  model,
}: {
  plan: string;
  name: string;
  provider: string;
  model: string;
}) {
  const [state, action, pending] = useActionState<AiFormState, FormData>(saveAiConfiguration, {
    message: null,
    reauth: false,
  });
  return (
    <form action={action} aria-label={`${name} 새 AI 설정`} className="flex flex-col gap-2">
      <input type="hidden" name="plan" value={plan} />
      <div className={group}>
        <label className={line}>
          <span className="text-body">제공자</span>
          <select name="provider" defaultValue={provider} className={input}>
            {Object.entries(providerLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={line}>
          <span className="shrink-0 text-body">모델</span>
          <input name="model" defaultValue={model} required className={`${input} flex-1`} />
        </label>
      </div>
      <button type="submit" disabled={pending} className={`${button.secondary} self-start`}>
        {pending ? "확인하는 중…" : "확인하고 테스트로 저장"}
      </button>
      <p role="status" className="text-caption text-muted empty:hidden">
        {state.message}
      </p>
    </form>
  );
}
