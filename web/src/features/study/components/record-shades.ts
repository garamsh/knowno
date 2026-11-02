// The 기록 page's chart shades, as the phone's (app/lib/study/src/stats_style.dart). The bands and
// the quiet week are 3:1 on the surface but 보통 in light, which its count carries; the bands are told apart by hue, and every two, and every two adjacent heatmap
// levels, differ in lightness by 1.5:1;
// src/features/study/__tests__/record-shades.test.ts reads these classes to check it.

/** The recall bands: 좋음, 보통 and 곧 잊음 in three hues, each beside its count in ink. */
export const bandShades = {
  strong: "bg-recall-strong",
  fair: "bg-recall-fair",
  fading: "bg-recall-fading",
} as const;

/** A mastered week that is not this one; this week's is the accent. */
export const quietWeekShade = "bg-chart-quiet";

/** A heatmap cell at each level, from a day without a card to the busiest third. */
export const heatShades = ["bg-hairline", "bg-ink/35", "bg-ink/65", "bg-ink"] as const;
