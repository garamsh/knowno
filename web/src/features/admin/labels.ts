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
  set_provider_key: "AI 제공자 키 저장",
  remove_provider_key: "AI 제공자 키 삭제",
  save_ai_configuration: "AI 설정 테스트로 저장",
  activate_ai_configuration: "AI 설정 적용",
  clear_ai_test: "AI 설정 테스트 끝",
  save_assistant_configuration: "말랑이 설정 테스트로 저장",
  activate_assistant_configuration: "말랑이 설정 적용",
  clear_assistant_test: "말랑이 설정 테스트 끝",
  save_assistant_prompt: "말랑이 프롬프트 저장",
  set_assistant_token_budget: "말랑이 하루 토큰 예산",
  save_card_form_skill: "카드 형식 스킬 테스트로 저장",
  activate_card_form_skill: "카드 형식 스킬 적용",
  clear_card_form_skill_test: "카드 형식 스킬 테스트 끝",
};

/** The card forms a skill is written for, in the order the assistant lists them (ADR 0197). */
export const cardForms = ["text", "senses", "cloze", "table", "image", "mixed"] as const;

/** A card form of a skill. */
export type CardForm = (typeof cardForms)[number];

/** Each card form's name, the chat's words for it. */
export const cardFormLabels: Record<CardForm, string> = {
  text: "글",
  senses: "단어",
  cloze: "빈칸 문장",
  table: "표",
  image: "사진",
  mixed: "섞어서",
};

/** [value], which crossed the network or an address, as a card form; null otherwise. */
export function parseCardForm(value: unknown): CardForm | null {
  return cardForms.find((form) => form === value) ?? null;
}

/** Each AI provider's name (ADR 0162). */
export const providerLabels: Record<string, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

/** Each reasoning effort of the assistant's model (ADR 0190). */
export const effortLabels: Record<string, string> = {
  none: "없음",
  low: "낮음",
  medium: "보통",
  high: "높음",
};

/**
 * Each plan's name in the admin area. 스페셜 has no photo limit (ADR 0177); log entries before ADR
 * 0097 name by it the plan Max replaced.
 */
export const planLabels: Record<string, string> = {
  free: "무료",
  pro: "프로",
  max: "맥스",
  special: "스페셜",
};

/**
 * A version's terms in words, as "한 달 10장", "하루 100장", "무제한 (하루 1000장까지)" or
 * 스페셜's "제한 없음".
 */
export function termsLabel(quota: string, amount: number | null): string {
  switch (quota) {
    case "monthly":
      return `한 달 ${String(amount)}장`;
    case "daily":
      return `하루 ${String(amount)}장`;
    case "unlimited":
      return `무제한 (하루 ${String(amount)}장까지)`;
    case "none":
      return "제한 없음";
    default:
      return amount === null ? quota : `${quota} ${String(amount)}장`;
  }
}

/** A daily token budget in words, as "하루 200,000토큰", or "제한 없음" for none. */
export function tokenBudgetLabel(tokens: unknown): string {
  return typeof tokens === "number" ? `하루 ${tokens.toLocaleString("ko-KR")}토큰` : "제한 없음";
}

/** [labels]' word for [key], or [key] itself when it has none. */
export function labelOf(labels: Record<string, string>, key: string): string {
  return labels[key] ?? key;
}
