"use client";

import { useActionState } from "react";

import { buttonClass } from "@/design/button";

import { grantPlan, type GrantPlanState } from "../grant-plan";
import { field, formInput, formLine, group } from "./admin-section";

/**
 * Puts a user on Pro, or on Max or 스페셜 with an optional last day: the content of the sheet
 * 요금제 바꾸기 opens, ending on its one primary, 지정.
 */
export function GrantPlanForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState<GrantPlanState, FormData>(grantPlan, {
    message: null,
  });
  return (
    <form action={action} aria-label="요금제 지정" className="flex flex-col gap-3 pt-2">
      <input type="hidden" name="user" value={userId} />
      <div className={group}>
        <label className={formLine}>
          <span className="text-body">바꿀 요금제</span>
          <select name="plan" defaultValue="pro" className={`${field} ${formInput}`}>
            <option value="pro">플러스</option>
            <option value="max">프로</option>
            <option value="special">스페셜</option>
          </select>
        </label>
        <div className="flex flex-col gap-1 px-4 py-3">
          <label className="flex items-center justify-between gap-3">
            <span className="text-body">마지막 날</span>
            <input
              type="date"
              name="ends_on"
              aria-describedby={`${userId}-ends`}
              className={`${field} ${formInput}`}
            />
          </label>
          <span id={`${userId}-ends`} className="text-caption text-muted">
            프로와 스페셜만 정할 수 있고, 비우면 끝없이 이어져요
          </span>
        </div>
      </div>
      <p role="status" className="px-1 text-caption text-muted empty:hidden">
        {state.message}
      </p>
      <button type="submit" disabled={pending} className={`${buttonClass("primary", "cta")} mt-2`}>
        지정
      </button>
    </form>
  );
}
