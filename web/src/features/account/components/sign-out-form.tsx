"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState } from "react";

import { signOut } from "../actions";

/**
 * The sign-out row, its word alone, showing progress at its end while sign-out runs, and the
 * reason beneath it when sign-out fails.
 */
export function SignOutForm() {
  const [state, action, pending] = useActionState(signOut, { error: null });
  return (
    <form action={action} className="flex flex-col">
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="pressable flex min-h-button items-center justify-between gap-3 px-4 py-3 text-left text-body-strong text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
      >
        로그아웃
        {pending && (
          <LoaderCircle aria-hidden className="size-5 motion-safe:animate-spin" strokeWidth={2} />
        )}
      </button>
      {state.error && (
        <p role="alert" className="px-4 pb-3 text-secondary text-dont-know-text">
          {state.error}
        </p>
      )}
    </form>
  );
}
