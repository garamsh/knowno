"use client";

import { useActionState } from "react";

import { signOut, type SignOutState } from "@/features/account/actions";

import type { AiFormState } from "../ai-settings";
import { saveStoreSecret } from "../save-store-secret";
import { button, field, formInput, formLine, group } from "./admin-section";

const input = `${field} ${formInput} flex-1`;

/**
 * Saves or replaces one RevenueCat secret (ADR 0241), the way the provider key form does (ADR
 * 0162): write-only, so the field starts empty and the page never shows a value back. A sign-in
 * older than 10 minutes is asked again: "다시 로그인" signs this browser out to `/login`.
 */
export function StoreSecretForm({
  name,
  label,
  replacing,
}: {
  name: string;
  label: string;
  replacing: boolean;
}) {
  const [state, action, pending] = useActionState<AiFormState, FormData>(saveStoreSecret, {
    message: null,
    reauth: false,
  });
  const [signedOut, signOutAction, signingOut] = useActionState<SignOutState>(signOut, {
    error: null,
  });
  return (
    <form action={action} aria-label={`${label} 값`} className="flex flex-col gap-2">
      <input type="hidden" name="name" value={name} />
      <div className={group}>
        <label className={formLine}>
          <span className="shrink-0 text-body">{replacing ? "새 값" : "값"}</span>
          <input
            name="value"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            className={input}
          />
        </label>
      </div>
      <button type="submit" disabled={pending} className={`${button.secondary} self-start`}>
        {pending ? "저장하는 중…" : replacing ? "값 바꾸기" : "값 저장"}
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
