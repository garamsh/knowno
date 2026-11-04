"use client";

import { useActionState } from "react";

import type { AiFormState } from "../ai-settings";
import { effortLabels, providerLabels } from "../labels";
import { saveAssistantConfiguration } from "../save-assistant-configuration";
import { button, field, formInput, formLine, group } from "./admin-section";

const input = `${field} ${formInput}`;

/**
 * A plan's new assistant configuration, its provider, model, prompt version, web search, searches
 * a message and reasoning effort, saved as its one draft only after one call with them parsed (ADR
 * 0190); the draft serves admins until 모두에게 적용, the page's one primary, so its button is
 * outlined. [versions] are the assistant's prompt versions, newest first.
 */
export function AssistantConfigurationForm({
  plan,
  name,
  start,
  versions,
}: {
  plan: string;
  name: string;
  /** The values the form starts from: the plan's draft's, or else its active one's. */
  start: {
    provider: string;
    model: string;
    promptVersionId: number;
    webSearch: boolean;
    maxSearches: number;
    reasoningEffort: string;
  };
  versions: readonly number[];
}) {
  const [state, action, pending] = useActionState<AiFormState, FormData>(
    saveAssistantConfiguration,
    { message: null, reauth: false },
  );
  return (
    <form action={action} aria-label={`${name} 새 초안`} className="flex flex-col gap-2">
      <input type="hidden" name="plan" value={plan} />
      <div className={group}>
        <label className={formLine}>
          <span className="text-body">제공자</span>
          <select name="provider" defaultValue={start.provider} className={input}>
            {Object.entries(providerLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={formLine}>
          <span className="shrink-0 text-body">모델</span>
          <input name="model" defaultValue={start.model} required className={`${input} flex-1`} />
        </label>
        <label className={formLine}>
          <span className="text-body">프롬프트</span>
          <select name="prompt_version_id" defaultValue={start.promptVersionId} className={input}>
            {versions.map((id) => (
              <option key={id} value={id}>
                v{id}
              </option>
            ))}
          </select>
        </label>
        <label className={formLine}>
          <span className="text-body">웹 검색</span>
          <input
            type="checkbox"
            name="web_search"
            defaultChecked={start.webSearch}
            className="size-5 shrink-0 accent-ink"
          />
        </label>
        <label className={formLine}>
          <span className="shrink-0 text-body">메시지당 검색</span>
          <input
            type="number"
            name="max_searches"
            min={1}
            max={10}
            required
            defaultValue={start.maxSearches}
            className={`${input} w-20`}
          />
        </label>
        <label className={formLine}>
          <span className="text-body">추론</span>
          <select name="reasoning_effort" defaultValue={start.reasoningEffort} className={input}>
            {Object.entries(effortLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="px-1 text-caption text-muted">
        OpenAI는 웹 검색을 하지 않아요. 검색 횟수는 웹 검색을 켰을 때만 써요.
      </p>
      <button type="submit" disabled={pending} className={`${button.secondary} self-start`}>
        {pending ? "확인하는 중…" : "확인하고 초안으로 저장"}
      </button>
      <p role="status" className="text-caption text-muted empty:hidden">
        {state.message}
      </p>
    </form>
  );
}
