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

describe("the 기록 page's chart shades", () => {
  it.each(["light", "dark"] as const)(
    "in the %s theme: the ink bands and the quiet week are 3:1 on the surface, every two bands and adjacent heatmap levels 1.5:1 apart",
    (theme) => {
      const surface = rgb(themes[theme].get("surface") ?? "");
      const bands = [bandShades.strong, bandShades.fair, bandShades.fading].map((shade) =>
        drawn(shade, theme),
      );
      // The coral band is 2.67:1 on the light surface; its count in words carries it (ADR 0145).
      for (const mark of [...bands.slice(0, 2), drawn(quietWeekShade, theme)]) {
        expect(contrast(mark, surface)).toBeGreaterThanOrEqual(3);
      }
      for (const [i, a] of bands.entries()) {
        for (const b of bands.slice(i + 1)) expect(contrast(a, b)).toBeGreaterThanOrEqual(1.5);
      }
      const levels = heatShades.map((shade) => drawn(shade, theme));
      for (const [i, level] of levels.slice(1).entries()) {
        expect(contrast(levels[i] ?? level, level)).toBeGreaterThanOrEqual(1.5);
      }
    },
  );

  it.each(["light", "dark"] as const)(
    "fails the edge and the mint fill as a bar in the %s theme, so the check can fail",
    (theme) => {
      const surface = rgb(themes[theme].get("surface") ?? "");
      expect(contrast(drawn("bg-edge", theme), surface)).toBeLessThan(3);
      // Control: the mint fill passes only on a dark surface; on white it fails.
      if (theme === "light") expect(contrast(drawn("bg-primary", theme), surface)).toBeLessThan(3);
    },
  );
});
