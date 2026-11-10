/** [value], which crossed the network, as a triage action's id: a whole number from 1; null otherwise. */
export function parseActionId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

/** The triage's two modes. */
export type TriageMode = "judge_only" | "acting";

/**
 * [value], a mode switch's choice, as a mode: `acting` only when it says exactly that, so a choice
 * that is missing or unknown leaves the AI judging and changing nothing (ADR 0244).
 */
export function parseTriageMode(value: unknown): TriageMode {
  return value === "acting" ? "acting" : "judge_only";
}
