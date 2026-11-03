import { ReadFailureMessage, unreachableMessage } from "@/design/read-failure";

import type { LibraryFailure } from "../read-library";

const messages: Record<LibraryFailure, string> = {
  unreachable: unreachableMessage,
  rejected: "로그인이 끝났어요. 다시 로그인해 주세요.",
  failed: "카드를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
  unreadable:
    "이 앱이 읽을 수 없는 카드가 있어 불러오지 못했어요. 휴대폰 앱에서 카드를 확인해 주세요.",
};

/**
 * What a page shows in place of the decks or cards it could not read, with the next step:
 * "로그인" when the session ended, and "다시 시도", which reads the page again, otherwise.
 */
export function ReadFailure({ failure }: { failure: LibraryFailure }) {
  return (
    <ReadFailureMessage
      message={messages[failure]}
      next={failure === "rejected" ? "login" : "retry"}
    />
  );
}
