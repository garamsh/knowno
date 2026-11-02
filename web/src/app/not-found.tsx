import Link from "next/link";

/** What a page shows when what it names does not exist. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-bold">찾는 페이지가 없어요</h1>
      <p className="text-muted">
        삭제되었거나 주소가 잘못되었어요. 노트 목록에서 다시 골라 주세요.
      </p>
      <Link
        href="/decks"
        className="pressable flex min-h-button items-center justify-center rounded-button bg-primary px-6 text-button text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        노트 목록
      </Link>
    </main>
  );
}
