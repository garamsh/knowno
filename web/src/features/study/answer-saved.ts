/**
 * When this tab last saved a study answer, by the browser's clock. It lives at module level, so
 * a write that lands after the study screen has gone is still recorded (ADR 0169).
 */
let savedAt: number | null = null;
const listeners = new Set<() => void>();

/** Records that an answer was saved now, and tells every listener. */
export function markAnswerSaved(): void {
  savedAt = Date.now();
  for (const listener of listeners) listener();
}

/** When the last answer was saved, or null when none has been in this tab. */
export function answerSavedAt(): number | null {
  return savedAt;
}

/** Calls [listener] after each saved answer; returns the function that stops it. */
export function subscribeAnswerSaved(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
