"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** "다시 시도", which reads the page again from the server once per press. */
export function RetryButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(() => {
          router.refresh();
        });
      }}
      className="flex min-h-button items-center justify-center self-start rounded-button bg-surface px-5 text-button text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
    >
      다시 시도
    </button>
  );
}
