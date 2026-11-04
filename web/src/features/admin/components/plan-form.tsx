"use client";

import { useActionState, useId } from "react";

import { createPlanVersion, type PlanFormState } from "../create-plan-version";
import type { Quota } from "../read-admin";
import { buttonClass } from "@/design/button";

import { field, formInput, formLine, group } from "./admin-section";

const input = `${field} ${formInput}`;

/**
 * A new version of one plan's terms, starting from the current version's, at the foot of the plan's
 * sheet, whose one primary, 만들기, it ends on.
 */
export function PlanForm({
  plan,
  name,
  quota,
  amount,
}: {
  plan: string;
  name: string;
  quota: Quota;
  amount: number;
}) {
  const [state, action, pending] = useActionState<PlanFormState, FormData>(createPlanVersion, {
    message: null,
  });
  const id = useId();
  return (
    <form action={action} aria-label={`${name} 새 버전`} className="flex flex-col gap-2">
      <h3 className="px-1 text-section text-muted">새 버전</h3>
      <input type="hidden" name="plan" value={plan} />
      <div className={group}>
        <label className={formLine}>
          <span className="text-body">한도</span>
          <select name="quota" defaultValue={quota} className={input}>
            <option value="monthly">한 달에</option>
            <option value="daily">하루에</option>
            <option value="unlimited">무제한 (하루 공정 사용 한도)</option>
          </select>
        </label>
        <label className={formLine}>
          <span className="text-body">사진 장 수</span>
          <input
            name="amount"
            type="number"
            min={0}
            max={100_000}
            defaultValue={amount}
            required
            className={`${input} w-28`}
          />
        </label>
        <div className="flex flex-col gap-1 px-4 py-3">
          <label className="flex items-center justify-between gap-3">
            <span className="text-body">시작일</span>
            <input
              type="date"
              name="starts_on"
              aria-describedby={`${id}-start`}
              className={input}
            />
          </label>
          <span id={`${id}-start`} className="text-caption text-muted">
            비우면 지금부터 적용돼요
          </span>
        </div>
        <div className="flex flex-col gap-1 px-4 py-3">
          <label className="flex items-center justify-between gap-3">
            <span className="text-body">기존 사용자에게도 시작일부터 적용</span>
            <input
              type="checkbox"
              name="applies_to_all"
              aria-describedby={`${id}-all`}
              className="size-5 shrink-0 accent-ink"
            />
          </label>
          <span id={`${id}-all`} className="text-caption text-muted">
            사용자에게 유리한 변경만 고를 수 있고, 아니면 다음 갱신일인 매월 1일부터 적용돼요
          </span>
        </div>
      </div>
      <p role="status" className="px-1 text-caption text-muted empty:hidden">
        {state.message}
      </p>
      <button type="submit" disabled={pending} className={`${buttonClass("primary", "cta")} mt-2`}>
        만들기
      </button>
    </form>
  );
}
