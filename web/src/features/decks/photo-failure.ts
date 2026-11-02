/** Why a photo gave no cards: the phone's `PhotoImportFailure` kinds the web can meet. */
export type PhotoFailure =
  | { kind: "offline" }
  | { kind: "refused" }
  | { kind: "noCards" }
  | { kind: "suspended" }
  | { kind: "unavailable" }
  | { kind: "limit"; limit: number; period: "day" | "month" }
  | { kind: "model" }
  | { kind: "signIn" }
  | { kind: "service" }
  | { kind: "unreadable" };

/** The message a user reads for [failure], the phone's `app_ko.arb` text for each kind. */
export function describeFailure(failure: PhotoFailure): string {
  switch (failure.kind) {
    case "offline":
      return "인터넷에 연결되지 않았어요. 연결을 확인하고 다시 시도해 주세요.";
    case "refused":
      return "이 사진은 보낼 수 없어요. 다시 찍거나 다른 사진을 골라 주세요.";
    case "noCards":
      return "카드를 찾지 못했어요. 더 밝고 반듯하게 찍어 보세요.";
    case "suspended":
      return "이 계정은 이용이 정지됐어요. 문의는 sauce@garam.sh로 보내 주세요.";
    case "unavailable":
      return "지금은 사진으로 카드를 만들 수 없어요. 직접 입력이나 엑셀·CSV로 추가해 주세요.";
    case "limit":
      return failure.period === "day"
        ? `오늘 사진으로 만들 수 있는 ${String(failure.limit)}장을 다 썼어요. 내일 다시 시도해 주세요.`
        : `이번 달 사진으로 만들 수 있는 ${String(failure.limit)}장을 다 썼어요. 다음 달 1일에 다시 시도해 주세요.`;
    case "model":
      return "카드를 읽지 못했어요. 잠시 후 다시 시도해 주세요.";
    case "signIn":
      return "로그인이 필요해요. 설정에서 다시 로그인해 주세요.";
    case "service":
      return "지금은 사진으로 카드를 만들 수 없어요. 잠시 후 다시 시도해 주세요.";
    case "unreadable":
      // The browser decodes the photo; the formats every browser decodes are named (#506).
      return "이 사진을 읽을 수 없어요. JPEG, PNG, WebP 사진을 골라 주세요.";
  }
}

/** Whether sending the same photo again can succeed, as the phone's `isRetryable`. */
export function isRetryable(failure: PhotoFailure): boolean {
  return failure.kind === "offline" || failure.kind === "model" || failure.kind === "service";
}

/** Whether a new photo can succeed where this one failed, as the phone's `isRetakeable`. */
export function isRetakeable(failure: PhotoFailure): boolean {
  return (
    failure.kind !== "limit" &&
    failure.kind !== "signIn" &&
    failure.kind !== "suspended" &&
    failure.kind !== "unavailable"
  );
}
