// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { bandShades, heatShades, quietWeekShade } from "../components/record-shades";

// The 기록 page's chart shades read from the classes it draws them with, against the tokens of
// src/styles/globals.css in each theme: each band and the quiet week 3:1 on the surface, and every
// two bands and every two adjacent heatmap levels 1.5:1 apart in lightness, as on the phone.

const globalsCss = readFileSync(
  path.join(import.meta.dirname, "../../../styles/globals.css"),
  "utf8",
);

function colours(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6});/g)].map(([, name, hex]) => [
      String(name),
      String(hex),
    ]),
  );
}

const themes = {
  light: colours(/@theme \{([^}]*)\}/.exec(globalsCss)?.[1] ?? ""),
  dark: colours(/:root\[data-theme="dark"\] \{([^}]*--color[^}]*)\}/.exec(globalsCss)?.[1] ?? ""),
};

type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb;

function luminance([r, g, b]: Rgb): number {
  const [lr = 0, lg = 0, lb = 0] = [r, g, b].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(a: Rgb, b: Rgb): number {
  const [light = 0, dark = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The colour the background class [shade] draws over the surface in [theme]: `bg-<token>` or
 * `bg-<token>/<alpha>`, with a `dark:` class taking over in the dark theme.
 */
function drawn(shade: string, theme: "light" | "dark"): Rgb {
  const classes = shade.split(" ");
  const chosen =
    (theme === "dark" ? classes.find((name) => name.startsWith("dark:")) : undefined) ??
    classes.find((name) => !name.startsWith("dark:")) ??
    "";
  const match = /bg-([\w-]+?)(?:\/(\d+))?$/.exec(chosen.replace(/^dark:/, ""));
  const token = themes[theme].get(match?.[1] ?? "");
  if (!token) throw new Error(`no colour token for ${shade} in the ${theme} theme`);
  const alpha = Number(match?.[2] ?? 100) / 100;
  const surface = rgb(themes[theme].get("surface") ?? "");
  const colour = rgb(token);
  return colour.map((channel, at) => alpha * channel + (1 - alpha) * (surface[at] ?? 0)) as Rgb;
}

/** The hue of [rgb] in degrees. */
function hue([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b);
  const span = max - Math.min(r, g, b);
  if (span === 0) return 0;
  const turn =
    max === r ? ((g - b) / span) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return (turn * 60 + 360) % 360;
}

/** How far apart [a] and [b] are in hue, in degrees. */
function hueApart(a: Rgb, b: Rgb): number {
  const turn = Math.abs(hue(a) - hue(b));
  return turn > 180 ? 360 - turn : turn;
}

describe("the 기록 page's chart shades", () => {
  it.each(["light", "dark"] as const)(
    "in the %s theme: the bands and the quiet week are 3:1 on the surface but 보통 in light, the bands 45 degrees apart in hue, and adjacent heatmap levels 1.5:1 apart",
    (theme) => {
      const surface = rgb(themes[theme].get("surface") ?? "");
      const [strong, fair, fading] = [bandShades.strong, bandShades.fair, bandShades.fading].map(
        (shade) => drawn(shade, theme),
      );
      if (!strong || !fair || !fading) throw new Error("three bands are drawn");
      // 보통 is under 3:1 on the light surface; its count in ink carries it (ADR 0147).
      for (const mark of [
        strong,
        ...(theme === "dark" ? [fair] : []),
        fading,
        drawn(quietWeekShade, theme),
      ]) {
        expect(contrast(mark, surface)).toBeGreaterThanOrEqual(3);
      }
      // The bands are told apart by hue, 45 degrees or more apart.
      for (const [a, b] of [
        [strong, fair],
        [fair, fading],
        [strong, fading],
      ] as const) {
        expect(hueApart(a, b)).toBeGreaterThanOrEqual(45);
      }
      const levels = heatShades.map((shade) => drawn(shade, theme));
      for (const [i, level] of levels.slice(1).entries()) {
        expect(contrast(levels[i] ?? level, level)).toBeGreaterThanOrEqual(1.5);
      }
    },
  );

  it.each(["light", "dark"] as const)(
    "fails the edge as a bar in the %s theme, so the check can fail",
    (theme) => {
      const surface = rgb(themes[theme].get("surface") ?? "");
      expect(contrast(drawn("bg-edge", theme), surface)).toBeLessThan(3);
      // Control: today's bar and the other days' share a hue, so the hue check can fail.
      expect(hueApart(drawn("bg-accent", theme), drawn("bg-chart-other", theme))).toBeLessThan(45);
    },
  );
});
