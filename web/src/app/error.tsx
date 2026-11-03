"use client";

import Link from "next/link";

import { buttonClass } from "@/design/button";

/** What a page shows when rendering it failed unexpectedly: a retry, and a way back to 오늘. */
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-title">문제가 생겼어요</h1>
      <p className="text-muted">잠시 후 다시 시도해 주세요.</p>
      <button
        type="button"
        onClick={reset}
        className={buttonClass("primary")}
      >
        다시 시도
      </button>
      <Link
        href="/"
        className={buttonClass("secondary")}
      >
        홈으로 가기
      </Link>
    </main>
  );
}
