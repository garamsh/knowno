/** The longest prompt version the server keeps, in characters (ADR 0073). */
export const maxPromptLength = 20_000;

/** The longest note a version keeps, in characters. */
export const maxNoteLength = 200;

/** Why [text] and [note] cannot be saved as a version, or null when they can. */
export function promptRefusal(text: string, note: string): string | null {
  if (text.trim() === "" || codePoints(text) > maxPromptLength) {
    return "프롬프트를 2만 자 안으로 적어 주세요.";
  }
  if (codePoints(note.trim()) > maxNoteLength) return "메모는 200자 안으로 적어 주세요.";
  return null;
}

/** [value]'s length in code points, as Postgres' `char_length` counts it. */
function codePoints(value: string): number {
  return value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "_").length;
}
