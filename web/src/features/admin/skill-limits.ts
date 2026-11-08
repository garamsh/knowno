import { maxNoteLength } from "./prompt-limits";

/** The longest summary a skill keeps, in characters (ADR 0197). */
export const maxSummaryLength = 300;

/** The longest guide a skill keeps, in characters. */
export const maxSkillLength = 20_000;

/** Why [summary], [text] and [note] cannot be saved as a skill version, or null when they can. */
export function skillRefusal(summary: string, text: string, note: string): string | null {
  const line = summary.trim();
  if (line === "" || /[\n\r]/.test(line) || codePoints(line) > maxSummaryLength) {
    return "한 줄 요약을 300자 안으로 적어 주세요.";
  }
  if (text.trim() === "" || codePoints(text) > maxSkillLength) {
    return "가이드를 2만 자 안으로 적어 주세요.";
  }
  if (codePoints(note.trim()) > maxNoteLength) return "메모는 200자 안으로 적어 주세요.";
  return null;
}

/** [value]'s length in code points, as Postgres' `char_length` counts it. */
function codePoints(value: string): number {
  return value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "_").length;
}
