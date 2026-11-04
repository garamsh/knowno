"use client";

import { useActionState } from "react";

import { type BudgetFormState, setAssistantTokenBudget } from "../set-assistant-token-budget";
import { button, field, formInput, formLine, group } from "./admin-section";

/**
 * A plan's daily assistant token budget, from 0 to 1,000,000,000, or none while 제한 없음 is
 * checked, starting from [tokens]. 모두에게 적용 is the page's one primary, so its button is
 * outlined.
 */
export function AssistantBudgetForm({
  plan,
  name,
  tokens,
}: {
  plan: string;
  name: string;
  tokens: number | null;
}) {
  const [state, action, pending] = useActionState<BudgetFormState, FormData>(
    setAssistantTokenBudget,
    { message: null },
  );
  return (
    <form
      action={action}
      aria-label={`${name} 하루 토큰 예산`}
      className="mt-2 flex flex-col gap-2"
    >
      <input type="hidden" name="plan" value={plan} />
      <div className={group}>
        <label className={formLine}>
          <span className="shrink-0 text-body">하루 토큰</span>
          <input
            type="number"
            name="daily_tokens"
            min={0}
            max={1_000_000_000}
            step={1}
            defaultValue={tokens ?? ""}
            className={`${field} ${formInput} w-40`}
          />
        </label>
        <label className={formLine}>
          <span className="text-body">제한 없음</span>
          <input
            type="checkbox"
            name="none"
            defaultChecked={tokens === null}
            className="size-5 shrink-0 accent-ink"
          />
        </label>
      </div>
      <button type="submit" disabled={pending} className={`${button.secondary} self-start`}>
        예산 저장
      </button>
      <p role="status" className="text-caption text-muted empty:hidden">
        {state.message}
      </p>
    </form>
  );
}
