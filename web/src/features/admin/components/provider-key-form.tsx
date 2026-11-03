"use client";

import { useActionState, useId } from "react";

import { signOut, type SignOutState } from "@/features/account/actions";

import type { AiFormState } from "../ai-settings";
import { saveProviderKey } from "../save-provider-key";
import { button, field, group } from "./admin-section";

const line = "flex min-h-button items-center justify-between gap-3 px-4";
const input = `${field} h-tap-target min-w-0 flex-1 px-2 text-right`;

/**
 * Saves or replaces one provider's key (ADR 0162). The key is write-only: the field starts empty,
 * the page never shows it back, and it is stored only after one call with it and [model] parsed.
 * A sign-in older than 10 minutes is asked again: "다시 로그인" signs this browser out to `/login`.
 */
export function ProviderKeyForm({
  provider,
  name,
  model,
  replacing,
}: {
  provider: string;
  name: string;
  /** The model the check call uses, the one an active configuration of the provider serves. */
  model: string;
  replacing: boolean;
}) {
  const [state, action, pending] = useActionState<AiFormState, FormData>(saveProviderKey, {
    message: null,
    reauth: false,
  });
  const [signedOut, signOutAction, signingOut] = useActionState<SignOutState>(signOut, {
    error: null,
  });
  const id = useId();
  return (
    <form action={action} aria-label={`${name} 키`} className="flex flex-col gap-2">
      <input type="hidden" name="provider" value={provider} />
      <div className={group}>
        <label className={line}>
          <span className="shrink-0 text-body">{replacing ? "새 키" : "키"}</span>
          <input
            name="key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            className={input}
          />
        </label>
        <div className="flex flex-col gap-1 px-4 py-3">
          <label className="flex items-center justify-between gap-3">
            <span className="shrink-0 text-body">확인할 모델</span>
            <input
              name="model"
              defaultValue={model}
              required
              aria-describedby={`${id}-model`}
              className={input}
            />
          </label>
          <span id={`${id}-model`} className="text-caption text-muted">
            저장하기 전에 이 모델로 사진 한 장을 한 번 읽어 봐요
          </span>
        </div>
      </div>
      <button type="submit" disabled={pending} className={`${button.secondary} self-start`}>
        {pending ? "확인하는 중…" : replacing ? "키 바꾸기" : "키 저장"}
      </button>
      <p role="status" className="text-caption text-muted empty:hidden">
        {state.message}
      </p>
      {state.reauth && (
        <button
          type="submit"
          formAction={signOutAction}
          formNoValidate
          disabled={signingOut}
          className={`${button.secondary} self-start`}
        >
          다시 로그인
        </button>
      )}
      <p className="text-caption text-muted empty:hidden">{signedOut.error}</p>
    </form>
  );
}
