"use client";

import { useActionState } from "react";

import { grantPlan, type GrantPlanState } from "../grant-plan";
import { button, field, formInput, formLine, group } from "./admin-section";

/** Puts a user on Pro, or on Max or 스페셜 with an optional last day. */
export function GrantPlanForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState<GrantPlanState, FormData>(grantPlan, {
    message: null,
  });
  return (
    <form action={action} aria-label="요금제 지정" className="mt-2 flex flex-col gap-3">
      <input type="hidden" name="user" value={userId} />
      <div className={group}>
        <label className={formLine}>
          <span className="text-body">바꿀 요금제</span>
          <select name="plan" defaultValue="pro" className={`${field} ${formInput}`}>
            <option value="pro">프로</option>
            <option value="max">맥스</option>
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
            맥스와 스페셜만 정할 수 있고, 비우면 끝없이 이어져요
          </span>
        </div>
      </div>
      <button type="submit" disabled={pending} className={button.primary}>
        지정
      </button>
      <p role="status" className="text-caption text-muted empty:hidden">
        {state.message}
      </p>
    </form>
  );
}
