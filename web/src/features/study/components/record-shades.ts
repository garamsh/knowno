// The 기록 page's chart shades, as the phone's (app/lib/study/src/stats_style.dart). The bands and
// the quiet week are 3:1 on the surface but fair, which its count carries, and every two bands, and every two adjacent heatmap
// levels, differ in lightness by 1.5:1;
// src/features/study/__tests__/record-shades.test.ts reads these classes to check it.

/** The recall bands: strong in the accent, fair in the chart's other colour, fading in its red. */
export const bandShades = {
  strong: "bg-accent",
  fair: "bg-chart-other",
  fading: "bg-chart-fading",
} as const;

/** A mastered week that is not this one; this week's is the accent. */
export const quietWeekShade = "bg-chart-quiet";

/** A heatmap cell at each level, from a day without a card to the busiest third. */
export const heatShades = ["bg-hairline", "bg-ink/35", "bg-ink/65", "bg-ink"] as const;
