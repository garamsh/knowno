/** What a deck report's reason reads as, the app's words for each (`app_ko.arb`'s `report*`). */
export const reasonLabels: Record<string, string> = {
  inappropriate: "부적절한 내용",
  spam: "스팸",
  copyright: "저작권 침해",
  other: "기타",
};

/** What each recorded admin action reads as in the log; an action this version does not know shows its name. */
export const actionLabels: Record<string, string> = {
  hide_deck: "노트 숨기기",
  unhide_deck: "노트 숨김 해제",
  unpublish_deck: "노트 비공개로 전환",
  dismiss_reports: "신고 정리",
  grant_admin: "관리자 지정",
  revoke_admin: "관리자 해제",
  set_plan: "요금제 설정",
  create_plan_version: "요금제 새 버전",
  grant_plan: "요금제 지정",
  revoke_plan: "무료로 되돌리기",
  grant_unlimited: "무제한 지정",
  revoke_unlimited: "무제한 해제",
  suspend_user: "이용 정지",
  unsuspend_user: "정지 해제",
  remove_deck: "공유에서 영구 삭제",
  save_prompt: "프롬프트 저장",
  activate_prompt: "프롬프트 적용",
  test_prompt: "프롬프트 테스트 시작",
  clear_test_prompt: "프롬프트 테스트 끝",
};

/** Each plan's name in the admin area; Special, which Max replaced, names log entries before it. */
export const planLabels: Record<string, string> = {
  free: "무료",
  pro: "프로",
  max: "맥스",
  special: "스페셜",
};

/** A version's terms in words, as "한 달 10장", "하루 100장" or "무제한 (하루 1000장까지)". */
export function termsLabel(quota: string, amount: number): string {
  switch (quota) {
    case "monthly":
      return `한 달 ${String(amount)}장`;
    case "daily":
      return `하루 ${String(amount)}장`;
    case "unlimited":
      return `무제한 (하루 ${String(amount)}장까지)`;
    default:
      return `${quota} ${String(amount)}장`;
  }
}

/** [labels]' word for [key], or [key] itself when it has none. */
export function labelOf(labels: Record<string, string>, key: string): string {
  return labels[key] ?? key;
}
