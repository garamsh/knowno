"use client";

import { useActionState } from "react";

import { grantUnlimited, type GrantUnlimitedState } from "../grant-unlimited";
import { button, field, group } from "./admin-section";

/** Grants a user 무제한, with an optional last day. */
export function GrantUnlimitedForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState<GrantUnlimitedState, FormData>(
    grantUnlimited,
    { message: null },
  );
  return (
    <form action={action} aria-label="무제한 지정" className="mt-2 flex flex-col gap-3">
      <input type="hidden" name="user" value={userId} />
      <div className={group}>
        <div className="flex flex-col gap-1 px-4 py-3">
          <label className="flex items-center justify-between gap-3">
            <span className="text-body">마지막 날</span>
            <input
              type="date"
              name="ends_on"
              aria-describedby={`${userId}-unlimited-ends`}
              className={`${field} h-tap-target px-2`}
            />
          </label>
          <span id={`${userId}-unlimited-ends`} className="text-caption text-muted">
            비우면 끝없이 이어지고, 끝나면 요금제 한도로 돌아가요
          </span>
        </div>
      </div>
      <button type="submit" disabled={pending} className={button.row}>
        무제한으로 지정
      </button>
      <p role="status" className="text-caption text-muted empty:hidden">
        {state.message}
      </p>
    </form>
  );
}
