/**
 * The eval's measured cost of one photo, in US dollars, for each model it has measured: the PM's
 * runs of 2026-10-19 on prompt v6 over the 47 samples (issue #217). A model without a
 * measurement has none here.
 */
const measured: Record<string, number> = {
  "anthropic/claude-haiku-5.5": 0.0018,
  "anthropic/claude-sonnet-5.5": 0.0267,
};

/** [model]'s measured cost per photo, or null when the eval has not measured it. */
export function usdPerPhoto(model: string): number | null {
  return measured[model] ?? null;
}

/** [photos] at [usd] each, in dollars with four decimals, as "$0.0540"; "—" without a cost. */
export function estimatedCost(photos: number, usd: number | null): string {
  return usd === null ? "—" : `$${(photos * usd).toFixed(4)}`;
}
