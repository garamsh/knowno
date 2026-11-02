import { usdPerPhoto } from "./model-costs";
import type { PlanId } from "./read-admin";

/** One row of the server's breakdown: a UTC day's photos served by one plan, model and version. */
export type BreakdownRow = {
  day: string;
  /** Null for a photo counted before calls were recorded (ADR 0073). */
  plan: PlanId | null;
  model: string | null;
  promptVersion: number | null;
  photos: number;
};

/** Photos and their estimated cost; `unpriced` photos were served by a model never measured. */
export type Amount = { photos: number; usd: number; unpriced: number };

/** The photos of the last 7 UTC days against the 7 before, as 처리할 일's 이번 주 shows them. */
export type WeekUsage = {
  current: Amount;
  previous: Amount;
  /** The models with photos and no measured cost. */
  unpricedModels: string[];
};

/** How many UTC days the two weeks read. */
export const weekUsageDays = 14;

/** The UTC day [offset] days from [today], as YYYY-MM-DD. */
function dayFrom(today: string, offset: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

const empty = (): Amount => ({ photos: 0, usd: 0, unpriced: 0 });

/**
 * The last 7 UTC days ending [today] and the 7 before, from the server's [rows]: each photo costed
 * at its model's measured cost, and a photo without a call record at [freeModel]'s (ADR 0074).
 */
export function summarizeWeeks(
  rows: readonly BreakdownRow[],
  today: string,
  freeModel: string | null,
): WeekUsage {
  const currentStart = dayFrom(today, -6);
  const previousStart = dayFrom(today, -13);
  const current = empty();
  const previous = empty();
  const unpriced = new Set<string>();
  for (const row of rows) {
    if (row.day > today || row.day < previousStart) continue;
    const amount = row.day >= currentStart ? current : previous;
    const model = row.model ?? freeModel;
    const usd = model === null ? null : usdPerPhoto(model);
    if (usd === null && model !== null) unpriced.add(model);
    amount.photos += row.photos;
    if (usd === null) amount.unpriced += row.photos;
    else amount.usd += row.photos * usd;
  }
  return { current, previous, unpricedModels: [...unpriced].toSorted() };
}
