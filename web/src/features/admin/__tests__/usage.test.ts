import { describe, expect, it } from "vitest";

import { type BreakdownRow, summarizeWeeks } from "../usage";

const haiku = "anthropic/claude-haiku-5.5"; // measured at $0.0018 a photo
const sonnet = "anthropic/claude-sonnet-5.5"; // measured at $0.0267
const row = (
  day: string,
  photos: number,
  plan: BreakdownRow["plan"],
  model: string | null,
): BreakdownRow => ({ day, photos, plan, model, promptVersion: null });

// Today is 2026-10-19: this week runs from 10-13, the week before from 10-06 to 10-12.
const rows: BreakdownRow[] = [
  row("2026-10-19", 10, "free", haiku),
  row("2026-10-19", 2, "pro", sonnet),
  row("2026-10-13", 5, "free", haiku),
  row("2026-10-12", 4, null, null),
  row("2026-10-06", 3, "max", "vendor/unmeasured"),
  row("2026-10-05", 99, "free", haiku),
];

describe("the photos of 이번 주", () => {
  const usage = summarizeWeeks(rows, "2026-10-19", haiku);

  it("sums the last 7 UTC days, today's and the 7th day back included, each photo at its model's measured cost", () => {
    expect(usage.current).toEqual({
      photos: 17,
      usd: 15 * 0.0018 + 2 * 0.0267,
      unpriced: 0,
    });
  });

  it("sums the 7 days before apart, an unrecorded photo at the Free plan's model, and leaves out older days", () => {
    expect(usage.previous).toEqual({ photos: 7, usd: 4 * 0.0018, unpriced: 3 });
  });

  it("names a model never measured, whose photos it counts but cannot cost", () => {
    expect(usage.unpricedModels).toEqual(["vendor/unmeasured"]);
  });

  it("counts an unrecorded photo as unpriced while Free has no model", () => {
    expect(summarizeWeeks(rows, "2026-10-19", null).previous).toEqual({
      photos: 7,
      usd: 0,
      unpriced: 7,
    });
  });
});
