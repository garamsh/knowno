"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { buttonClass } from "./button";

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
      className={`${buttonClass("secondary")} self-start`}
    >
      다시 시도
    </button>
  );
}
