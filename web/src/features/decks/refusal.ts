import { field } from "@/supabase/row";

/** What a refused note's owner reads for each kind of finding, one sentence naming no text. */
const sentences: Record<string, string> = {
  resident_number: "주민등록번호가 들어 있어서 공개할 수 없어요.",
  account: "계좌번호가 들어 있어서 공개할 수 없어요.",
  phone: "전화번호가 들어 있어서 공개할 수 없어요.",
  link: "링크가 들어 있어서 공개할 수 없어요.",
  kakao_id: "메신저 아이디가 들어 있어서 공개할 수 없어요.",
  contact: "연락처를 남기라는 문구가 들어 있어서 공개할 수 없어요.",
  repeat: "같은 문구가 여러 카드에 반복돼서 공개할 수 없어요.",
  term: "허용되지 않는 표현이 들어 있어서 공개할 수 없어요.",
};

const byAdmin = "운영자가 이 노트를 공개할 수 없다고 판단했어요.";
const unnamed = "이 노트는 공개할 수 없어요.";

/**
 * The sentence for a refusal as the server states it: [refusal], the layer that refused, and
 * [findings], whose first category names the reason; the generic sentence where neither names one.
 */
export function refusalSentence(refusal: unknown, findings: unknown): string {
  if (refusal === "admin") return byAdmin;
  const category = Array.isArray(findings) ? field(findings[0], "category") : undefined;
  return (typeof category === "string" ? sentences[category] : undefined) ?? unnamed;
}
