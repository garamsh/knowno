import "server-only";

import { readEngineModule } from "@/design/markup-engine-server";
import init, {
  type EngineError,
  type MemoryStateParts,
  type Outcome,
  retrievability,
  reviewCard,
  reviewNewCard,
  type Scheduled,
} from "@/design/engine-wasm/knowno_engine_wasm.js";
import type { CardState } from "./queue";

// The engine on the server, for the 기록 page's recall and mastered weeks (ADR 0047): the same
// WebAssembly module the browser runs, instantiated once per server process from its file's
// bytes, which the build traces into the standalone output and every serverless function.

/** One stored answer, as the engine folds it: "안다" or not, its time and its fuzz factor, null for none. */
export type FoldedAnswer = { know: boolean; reviewedAt: number; fuzzFactor: number | null };

let loaded: Promise<void> | undefined;

/** Loads the engine once per server process; a failed load is tried again by the next call. */
export function loadServerEngine(): Promise<void> {
  loaded ??= Promise.resolve()
    .then(() => init({ module_or_path: readEngineModule() }))
    .then(
      () => undefined,
      (error: unknown) => {
        loaded = undefined;
        throw error;
      },
    );
  return loaded;
}

/**
 * Loads the engine for a page, or the failure the page shows in place of what it could not read
 * when the module cannot load.
 */
export async function readyServerEngine(): Promise<{ ready: true } | { failure: "failed" }> {
  try {
    await loadServerEngine();
    return { ready: true };
  } catch {
    return { failure: "failed" };
  }
}

/**
 * The states a new card passes through over [answers], in the order given, one after each, or
 * the engine's typed `EngineError` for an answer it refuses.
 */
export async function foldStates(
  answers: readonly FoldedAnswer[],
): Promise<{ states: CardState[] } | { error: EngineError }> {
  await loadServerEngine();
  const states: CardState[] = [];
  for (const answer of answers) {
    const previous = states[states.length - 1];
    const at = toSeconds(answer.reviewedAt);
    const kind = answer.know ? "know" : "dontKnow";
    const outcome: Outcome<Scheduled> = previous
      ? reviewCard(toParts(previous), kind, at, answer.fuzzFactor)
      : reviewNewCard(kind, at, answer.fuzzFactor);
    if ("error" in outcome) return { error: outcome.error };
    states.push({
      stability: outcome.ok.state.stability,
      difficulty: outcome.ok.state.difficulty,
      lastReview: Number(outcome.ok.state.lastReview) * 1000,
      due: Number(outcome.ok.due) * 1000,
    });
  }
  return { states };
}

/** The probability of recall at [now] of a card in [state], or the engine's typed `EngineError`. */
export async function recallAt(
  state: CardState,
  now: number,
): Promise<{ recall: number } | { error: EngineError }> {
  await loadServerEngine();
  const outcome = retrievability(toParts(state), toSeconds(now));
  return "error" in outcome ? { error: outcome.error } : { recall: outcome.ok };
}

function toParts(state: CardState): MemoryStateParts {
  return {
    stability: state.stability,
    difficulty: state.difficulty,
    lastReview: toSeconds(state.lastReview),
  };
}

function toSeconds(milliseconds: number): bigint {
  return BigInt(Math.trunc(milliseconds / 1000));
}
