"use client";

import { useActionState } from "react";

import { signOut } from "@/features/account/actions";
import { buttonClass } from "@/design/button";

import { AdminBrand } from "./admin-brand";

/**
 * What the admin host shows a signed-in account that is not an admin (ADR 0178): the brand over
 * "관리", one line, and a way to sign in with another account, which ends this host's session and
 * opens its sign-in. Nothing of the area is read for it.
 */
export function AdminRefusal() {
  const [state, action, pending] = useActionState(signOut, { error: null });
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-list flex-col justify-center gap-6 px-gutter py-10 break-keep">
      <AdminBrand named />
      <h1 className="text-title">관리자만 들어올 수 있어요.</h1>
      <form action={action} className="flex flex-col gap-3">
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className={buttonClass("secondary")}
        >
          다른 계정으로 로그인
        </button>
        {state.error && (
          <p role="alert" className="text-caption text-dont-know-text">
            {state.error}
          </p>
        )}
      </form>
    </main>
  );
}
