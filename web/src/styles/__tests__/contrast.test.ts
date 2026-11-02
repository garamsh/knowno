// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contrast, layered, themes } from "@/testing/contrast";

const globalsCss = readFileSync(path.join(import.meta.dirname, "../globals.css"), "utf8");

/**
 * The text and its ground on the login, account and empty home pages and the shell's menus and
 * pages, by where they appear.
 */
const pairs: [string, string, string][] = [
  ["the welcome sentence on the panel", "ink-2", "ground"],
  ["the consent line on the surface", "muted", "surface"],
  ["the legal links on the surface", "ink-2", "surface"],
  ["a sign-in error on the surface", "dont-know-text", "surface"],
  ["Google's label on its fill", "google-label", "google-fill"],
  ["a theme's row and its check on the group", "ink", "surface"],
  ["a settings section's label on the ground", "muted", "ground"],
  ["the empty home's sentence on the ground", "muted", "ground"],
  ["the empty home's title on the ground", "ink", "ground"],
  ["the side menu's other pages on the surface", "ink-2", "surface"],
  ["the side menu's current page on its tint", "accent", "brand-tint"],
  ["the tab bar's current page on the surface", "accent", "surface"],
  ["a count on the ground", "accent", "ground"],
  ["the tab bar's other pages on the surface", "muted", "surface"],
  ["the today, backlog and deck page cards' figures and pills on the surface", "ink", "surface"],
  ["the today, backlog and deck page cards' quiet text on the surface", "muted", "surface"],
  ["the today, backlog and deck page cards' buttons on the primary fill", "on-primary", "primary"],
  ["an avatar's initial and a selection's check on the ink fill", "on-ink", "ink"],
  ["a red confirmation's label on its fill", "on-ink", "dont-know"],
  ["the done card's heading on its tint", "ink", "brand-tint"],
  ["the done card's next review on its tint", "ink-2", "brand-tint"],
  ["the done card's pills on the surface", "ink", "surface"],
  ["the done card's 학습하기 on the primary fill", "on-primary", "primary"],
  ["the catch-up's line and labels on the surface", "muted", "surface"],
  ["the last seven days' labels and a deck's progress on the surface", "muted", "surface"],
  ["the date and the breadcrumb on the ground", "muted", "ground"],
  ["the admin's red final button's label on its fill", "on-dont-know-text", "dont-know-text"],
];

describe("the text the login, account and empty home pages draw", () => {
  it("is measured on a pair known to fail", () => {
    // Control: black on white is 21:1, and #777 on white falls short.
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeLessThan(4.5);
  });

  it.each(["light", "dark"] as const)("meets WCAG AA, 4.5:1, in the %s theme", (theme) => {
    const set = themes[theme];
    expect(set.size).toBeGreaterThan(25);
    for (const [where, text, ground] of pairs) {
      const ratio = contrast(set.get(text) ?? "", set.get(ground) ?? "");
      expect({ where, aa: ratio >= 4.5 }).toEqual({ where, aa: true });
    }
  });
});

/**
 * The text the study screen draws on its grades, its answer buttons and its guide, by where it
 * appears.
 */
const studyPairs: [string, string, string][] = [
  ["the guide's size on the ground", "ink", "ground"],
  ["the guide's lines on the ground", "ink-2", "ground"],
  ["a 안다 card's front", "ink", "know-card"],
  ["a 안다 card's back", "ink-2", "know-card"],
  ["a 모른다 card's front", "ink", "dont-know-card"],
  ["a 모른다 card's back", "ink-2", "dont-know-card"],
  ["the 안다 chip's word", "on-know", "know"],
  ["the 모른다 chip's word", "on-dont-know-text", "dont-know-text"],
  ["the 안다 button's word", "on-know-tint", "tint-green"],
  ["the 모른다 button's word", "on-dont-know-tint", "tint-red"],
];

/** The marks the study screen draws, at 3:1 against what is around them. */
const studyMarks: [string, string, string][] = [
  ["the 안다 chip on its card", "know", "know-card"],
  ["the 안다 chip on the ground", "know", "ground"],
  ["the 모른다 chip on its card", "dont-know-text", "dont-know-card"],
  ["the 모른다 chip on the ground", "dont-know-text", "ground"],
  ["the streak's flame on the completion card and the 오늘 page's cards", "streak", "surface"],
  ["a progress bar on its track", "accent", "edge"],
  ["a chart's stressed bar on the surface", "accent", "surface"],
  ["a chart's quiet bar on the surface", "chart-quiet", "surface"],
  ["the fading recall band on the surface", "chart-fading", "surface"],
  ["the catch-up's amber bars on the surface", "streak", "surface"],
];

describe("the study screen's grades, answer buttons and streak", () => {
  it.each(["light", "dark"] as const)(
    "meet WCAG AA, 4.5:1 for text and 3:1 for marks, in the %s theme",
    (theme) => {
      const set = themes[theme];
      for (const [where, text, ground] of studyPairs) {
        const ratio = contrast(set.get(text) ?? "#000000", set.get(ground) ?? "#000000");
        expect({ where, aa: ratio >= 4.5 }).toEqual({ where, aa: true });
      }
      for (const [where, mark, ground] of studyMarks) {
        const ratio = contrast(set.get(mark) ?? "#000000", set.get(ground) ?? "#000000");
        expect({ where, aa: ratio >= 3 }).toEqual({ where, aa: true });
      }
    },
  );
});

/** The share of a control's text colour that `.pressable` lays over its fill on hover and press. */
const stateShare =
  Number(/--state-layer: color-mix\(in srgb, currentColor (\d+)%/.exec(globalsCss)?.[1]) / 100;

/**
 * The text a pressable control draws, its fill, and the text colour its state layer takes, by
 * where they appear.
 */
const statePairs: [string, string, string, string][] = [
  ["a primary button's label", "on-primary", "primary", "on-primary"],
  ["a quiet button's label on the surface", "ink", "surface", "ink"],
  ["a quiet admin button's label on the ground", "ink", "ground", "ink"],
  ["the side menu's other pages", "ink-2", "surface", "ink-2"],
  ["the menus' current page on its tint", "ink", "brand-tint", "ink"],
  ["the tab bar's other pages", "muted", "surface", "muted"],
  ["a row's title", "ink", "surface", "ink"],
  ["a row's second line under its title's layer", "muted", "surface", "ink"],
  ["a deck page card's back under its front's layer", "ink-2", "surface", "ink"],
  ["the 안다 button's word", "on-know-tint", "tint-green", "on-know-tint"],
  ["the 모른다 button's word", "on-dont-know-tint", "tint-red", "on-dont-know-tint"],
  ["안내 다시 보기 on the ground", "ink-2", "ground", "ink-2"],
  ["the completion card's 그만하기", "ink-2", "surface", "ink-2"],
  ["a 안다 card's front", "ink", "know-card", "ink"],
  ["a 안다 card's back", "ink-2", "know-card", "ink"],
  ["a 모른다 card's front", "ink", "dont-know-card", "ink"],
  ["a 모른다 card's back", "ink-2", "dont-know-card", "ink"],
  ["the coach's 건너뛰기 on the hero", "on-hero", "hero", "on-hero"],
  ["the coach's 다음 on its fill", "hero", "on-hero", "hero"],
  ["Google's label on its fill", "google-label", "google-fill", "google-label"],
];

describe("the text of a hovered or pressed control", () => {
  it("is measured under a layer that darkens its fill", () => {
    // Control: the layer is read from globals.css, and a heavier one fails the tightest pair.
    expect(stateShare).toBeGreaterThan(0);
    const set = themes.light;
    const muted = set.get("muted") ?? "";
    const tight = (share: number) =>
      contrast(muted, layered(set.get("surface") ?? "", set.get("ink") ?? "", share));
    expect(tight(stateShare)).toBeGreaterThanOrEqual(4.5);
    expect(tight(0.5)).toBeLessThan(4.5);
  });

  it.each(["light", "dark"] as const)("meets WCAG AA, 4.5:1, in the %s theme", (theme) => {
    const set = themes[theme];
    for (const [where, text, fill, layer] of statePairs) {
      const ground = layered(set.get(fill) ?? "#000000", set.get(layer) ?? "#000000", stateShare);
      const ratio = contrast(set.get(text) ?? "#000000", ground);
      expect({ where, aa: ratio >= 4.5 }).toEqual({ where, aa: true });
    }
  });
});
