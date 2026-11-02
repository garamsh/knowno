/** The eval's spend cap: the ledger of past runs, the dry estimate, and the per-call guard. */

import { MAX_OUTPUT_TOKENS } from "../../supabase/functions/extract-cards/model.ts";
import type { Candidate, Pricing } from "./models.ts";

/** The committed record of every run's spend; `budgetUsd` is the cap across all runs. */
export type Ledger = {
  readonly budgetUsd: number;
  readonly runs: readonly {
    readonly date: string;
    readonly spentUsd: number;
    readonly note: string;
  }[];
};

export function parseLedger(value: unknown): Ledger {
  const malformed = new Error(
    "spend.json is not a ledger of {budgetUsd, runs: [{date, spentUsd, note}]}",
  );
  if (
    !isRecord(value) || typeof value.budgetUsd !== "number" ||
    !Array.isArray(value.runs)
  ) throw malformed;
  const runs = value.runs.map((run: unknown) => {
    if (
      !isRecord(run) || typeof run.date !== "string" ||
      typeof run.spentUsd !== "number" || run.spentUsd < 0 ||
      typeof run.note !== "string"
    ) throw malformed;
    return { date: run.date, spentUsd: run.spentUsd, note: run.note };
  });
  return { budgetUsd: value.budgetUsd, runs };
}

export function spent(ledger: Ledger): number {
  return ledger.runs.reduce((total, run) => total + run.spentUsd, 0);
}

export function remaining(ledger: Ledger): number {
  return ledger.budgetUsd - spent(ledger);
}

// Typical tokens of one call: the system prompt with one photo, and a reply per card with
// room for hidden reasoning. A vocabulary card writes its fields twice over (answer and short);
// a note card writes a question, an answer of a sentence or two and its short form. The dry
// estimate uses these.
export const TYPICAL_PROMPT_TOKENS = 2500;
export const TYPICAL_VOCABULARY_TOKENS_PER_CARD = 45;
export const TYPICAL_NOTE_TOKENS_PER_CARD = 120;
export const TYPICAL_REASONING_TOKENS = 1000;
// The most one call's prompt is taken to cost: the guard before each call uses this, with
// the reply at the function's output cap.
export const WORST_PROMPT_TOKENS = 6000;

/** What a call of [promptTokens] and [completionTokens] costs at [pricing], uncached. */
export function cost(
  pricing: Pricing,
  promptTokens: number,
  completionTokens: number,
): number {
  return pricing.request + pricing.image + pricing.prompt * promptTokens +
    pricing.completion * completionTokens;
}

/** What one call to a model costs at most, the reply running to [maxTokens], the output cap. */
export function worstCallUsd(
  pricing: Pricing,
  maxTokens: number = MAX_OUTPUT_TOKENS,
): number {
  return cost(pricing, WORST_PROMPT_TOKENS, maxTokens);
}

/** How large one sample's reply is taken to be: its cards, and the typical tokens of each. */
export type SampleSize = {
  readonly cards: number;
  readonly tokensPerCard: number;
};

/**
 * The dry estimate of a run: every candidate over every sample, each priced as one typical call
 * to its model, the one call the function makes per photo.
 */
export function estimateUsd(
  candidates: readonly Candidate[],
  sizes: readonly SampleSize[],
): number {
  let total = 0;
  for (const candidate of candidates) {
    for (const size of sizes) {
      const reply = TYPICAL_REASONING_TOKENS + size.tokensPerCard * size.cards;
      total += cost(candidate.primary.pricing, TYPICAL_PROMPT_TOKENS, reply);
    }
  }
  return total;
}

/**
 * The cost of a call as OpenRouter reported it, the provider's upstream cost of a BYOK call
 * included (`costUsd` carries both), or priced from its tokens when it reported no
 * cost. A call that reported no usage, which a failed call does, costs nothing: OpenRouter did not
 * bill the failed calls of the 2026-10-18 run.
 */
export function callUsd(
  pricing: Pricing,
  usage: {
    promptTokens: number;
    completionTokens: number;
    costUsd: number | null;
  } | null,
): number {
  if (usage === null) return 0;
  return usage.costUsd ??
    cost(pricing, usage.promptTokens, usage.completionTokens);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
