import Link from "next/link";

import { buttonClass } from "@/design/button";

/** What a page shows when what it names does not exist. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-title">찾는 페이지가 없어요</h1>
      <p className="text-muted">삭제되었거나 주소가 잘못되었어요. 홈에서 다시 골라 주세요.</p>
      <Link
        href="/"
        className={buttonClass("primary")}
      >
        홈으로 가기
      </Link>
    </main>
  );
}
