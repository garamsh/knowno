import init, {
  type EngineError,
  type MemoryStateParts,
  type Outcome,
  reviewCard,
  reviewNewCard,
  type Scheduled,
} from "./engine-wasm/knowno_engine_wasm.js";
import type { Answer } from "./answer-write";
import type { CardState } from "./queue";

export type { EngineError };

/** One answer to a card, as the engine reviews it. */
export type ReviewInput = {
  answer: Answer;
  /** Milliseconds since the epoch; the engine counts whole seconds, so it is truncated. */
  reviewedAt: number;
  /** Where in its fuzz range the review's interval falls, from 0 to 1, 1 excluded. */
  fuzzFactor: number;
};

let loaded: Promise<void> | undefined;
let ready = false;

/** Whether the engine's module has loaded, so a synchronous call such as `todayOf` can run. */
export function engineLoaded(): boolean {
  return ready;
}

/**
 * Loads the engine's WebAssembly module once per page. engine-wasm is a link to the
 * repository's engine-wasm/pkg/, the module `scripts/wasm-bindgen.sh generate` writes; its glue names
 * the `.wasm` beside it, which the build serves as a static file and the glue fetches.
 */
export function loadEngine(): Promise<void> {
  loaded ??= init().then(
    () => {
      ready = true;
    },
    (error: unknown) => {
      // The next call tries again rather than failing for the life of the page.
      loaded = undefined;
      throw error;
    },
  );
  return loaded;
}

/**
 * The state of a card after [history], its answers in the order given, reviewed by the engine
 * one at a time from [before], the card's stored state, or from a new card when it has none.
 * Each review is fuzzed by its own factor, so replaying a history gives the same due times.
 * An input the engine refuses comes back as its typed `EngineError`.
 */
export async function schedule(
  before: CardState | null,
  history: readonly [ReviewInput, ...ReviewInput[]],
): Promise<{ state: CardState } | { error: EngineError }> {
  await loadEngine();
  let state = before;
  for (const review of history) {
    const at = toSeconds(review.reviewedAt);
    const outcome: Outcome<Scheduled> = state
      ? reviewCard(toParts(state), review.answer, at, review.fuzzFactor)
      : reviewNewCard(review.answer, at, review.fuzzFactor);
    if ("error" in outcome) return { error: outcome.error };
    state = {
      stability: outcome.ok.state.stability,
      difficulty: outcome.ok.state.difficulty,
      lastReview: toMilliseconds(outcome.ok.state.lastReview),
      due: toMilliseconds(outcome.ok.due),
    };
  }
  if (!state) throw new Error("a history of at least one review leaves a state");
  return { state };
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

function toMilliseconds(seconds: bigint): number {
  return Number(seconds) * 1000;
}
