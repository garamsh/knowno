import { ReadFailureMessage, unreachableMessage } from "@/design/read-failure";

import type { AdminFailure } from "../read-admin";

const messages: Record<AdminFailure, string> = {
  unreachable: unreachableMessage,
  rejected: "관리자만 볼 수 있어요.",
  failed: "불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
  unreadable: "받은 답을 읽지 못했어요. 페이지를 새로 고친 뒤 다시 시도해 주세요.",
};

/**
 * What an admin page shows in place of what it could not read: what failed and what to do, with
 * "다시 시도" unless the reader is not an admin.
 */
export function AdminFailureMessage({ failure }: { failure: AdminFailure }) {
  return (
    <ReadFailureMessage
      message={messages[failure]}
      next={failure === "rejected" ? "none" : "retry"}
    />
  );
}
