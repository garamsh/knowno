"use client";

import { useActionState } from "react";

import type { AiFormState } from "../ai-settings";
import { providerLabels } from "../labels";
import { saveAiConfiguration } from "../save-ai-configuration";
import { button, field, formInput, formLine, group } from "./admin-section";

const input = `${field} ${formInput}`;

/**
 * A plan's new provider, model and prompt version, saved as its one draft only after one call with
 * them parsed (ADR 0162); the draft serves admins until 모두에게 적용, the page's one primary, so
 * its button is outlined. [versions] are the prompt versions, newest first.
 */
export function AiConfigurationForm({
  plan,
  name,
  provider,
  model,
  promptVersionId,
  versions,
}: {
  plan: string;
  name: string;
  provider: string;
  model: string;
  promptVersionId: number;
  versions: readonly number[];
}) {
  const [state, action, pending] = useActionState<AiFormState, FormData>(saveAiConfiguration, {
    message: null,
    reauth: false,
  });
  return (
    <form action={action} aria-label={`${name} 새 초안`} className="flex flex-col gap-2">
      <input type="hidden" name="plan" value={plan} />
      <div className={group}>
        <label className={formLine}>
          <span className="text-body">제공자</span>
          <select name="provider" defaultValue={provider} className={input}>
            {Object.entries(providerLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={formLine}>
          <span className="shrink-0 text-body">모델</span>
          <input name="model" defaultValue={model} required className={`${input} flex-1`} />
        </label>
        <label className={formLine}>
          <span className="text-body">프롬프트</span>
          <select name="prompt_version_id" defaultValue={promptVersionId} className={input}>
            {versions.map((id) => (
              <option key={id} value={id}>
                v{id}
              </option>
            ))}
          </select>
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
