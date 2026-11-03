/**
 * When the server stored this tab's latest study answer, by the server's clock. It lives at
 * module level, so a write that lands after the study screen has gone is still recorded
 * (ADR 0169).
 */
let savedAt: number | null = null;
const listeners = new Set<() => void>();

/** Records an answer the server stored at [at], keeping the latest, and tells every listener. */
export function markAnswerSaved(at: number): void {
  savedAt = savedAt === null ? at : Math.max(savedAt, at);
  for (const listener of listeners) listener();
}

/** When the server stored the latest answer, or null when none has been in this tab. */
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
