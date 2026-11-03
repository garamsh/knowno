import Link from "next/link";

import { RetryButton } from "./retry-button";

/** What every read says when the server cannot be reached. */
export const unreachableMessage = "서버에 연결할 수 없어요. 연결을 확인하고 다시 시도해 주세요.";

/**
 * What a page shows in place of what it could not read, as an alert: the [message] in the red
 * text, then the [next] step — "다시 시도", which reads the page again from the server once per
 * press, "로그인" where the session ended, or none. It is no client module, so a server module
 * reads [unreachableMessage] from it.
 */
export function ReadFailureMessage({
  message,
  next,
}: {
  message: string;
  next: "retry" | "login" | "none";
}) {
  return (
    <div role="alert" className="flex flex-col gap-3">
      <p className="text-body text-dont-know-text">{message}</p>
      {next === "retry" && <RetryButton />}
      {next === "login" && (
        <Link href="/login" className="font-semibold underline">
          로그인
        </Link>
      )}
    </div>
  );
}
