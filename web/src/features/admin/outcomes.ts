/** The counts of one UTC day's calls served by one prompt version, as the server groups them. */
export type OutcomeCounts = {
  /** The calls with an outcome. */
  calls: number;
  ok: number;
  noCards: number;
  invalidOutput: number;
  modelError: number;
  retried: number;
  /** The retried calls a retry answered. */
  recovered: number;
  /** The calls without an outcome. */
  unrecorded: number;
};

export type OutcomeDay = OutcomeCounts & { day: string; promptVersion: number };

/** The outcomes the view shows: the period's counts, each day's and each version's. */
export type OutcomeSummary = {
  total: OutcomeCounts;
  /** Every day of the period, oldest first, today last. */
  days: { day: string; counts: OutcomeCounts }[];
  /** Each version with calls, newest first. */
  versions: { version: number; counts: OutcomeCounts }[];
};

/** How many days a version's results cover. */
export const outcomeDays = 30;

const none: OutcomeCounts = {
  calls: 0,
  ok: 0,
  noCards: 0,
  invalidOutput: 0,
  modelError: 0,
  retried: 0,
  recovered: 0,
  unrecorded: 0,
};

function add(a: OutcomeCounts, b: OutcomeCounts): OutcomeCounts {
  return {
    calls: a.calls + b.calls,
    ok: a.ok + b.ok,
    noCards: a.noCards + b.noCards,
    invalidOutput: a.invalidOutput + b.invalidOutput,
    modelError: a.modelError + b.modelError,
    retried: a.retried + b.retried,
    recovered: a.recovered + b.recovered,
    unrecorded: a.unrecorded + b.unrecorded,
  };
}

/** The failure rate over which the area draws it red (ADR 0155). */
export const failureAlarm = 0.05;

/** [rate] as a percent with one decimal, as "3.2%". */
export function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/** The share of [counts]' recorded calls that failed, or null when none was recorded. */
export function failureRate(counts: OutcomeCounts): number | null {
  return counts.calls === 0 ? null : (counts.invalidOutput + counts.modelError) / counts.calls;
}

/** [rows] summed over the [span] UTC days that end with [today], by day and by version. */
export function summarizeOutcomes(
  rows: OutcomeDay[],
  today: string,
  span = outcomeDays,
): OutcomeSummary {
  const end = Date.parse(`${today}T00:00:00Z`);
  const days = Array.from({ length: span }, (_, index) =>
    new Date(end - (span - 1 - index) * 86_400_000).toISOString().slice(0, 10),
  );
  const byDay = new Map(days.map((day) => [day, none]));
  const byVersion = new Map<number, OutcomeCounts>();
  let total = none;
  for (const row of rows) {
    const counts = byDay.get(row.day);
    if (counts === undefined) continue;
    byDay.set(row.day, add(counts, row));
    byVersion.set(row.promptVersion, add(byVersion.get(row.promptVersion) ?? none, row));
    total = add(total, row);
  }
  return {
    total,
    days: days.map((day) => ({ day, counts: byDay.get(day) ?? none })),
    versions: [...byVersion]
      .sort(([a], [b]) => b - a)
      .map(([version, counts]) => ({ version, counts })),
  };
}
