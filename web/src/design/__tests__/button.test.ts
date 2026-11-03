import { describe, expect, it } from "vitest";

import { buttonClass } from "../button";

const classes = (...args: Parameters<typeof buttonClass>) => buttonClass(...args).split(" ");

describe("the one button", () => {
  it.each([
    ["primary", ["bg-primary", "text-on-primary"]],
    ["onHero", ["bg-hero-button", "text-on-hero-button"]],
    ["secondary", ["bg-surface", "text-ink"]],
    ["tonal", ["bg-brand-tint", "text-accent"]],
    ["destructive", ["text-dont-know-text"]],
    ["destructiveFinal", ["bg-dont-know-text", "text-on-dont-know-text"]],
    ["text", ["text-ink"]],
    ["onHeroText", ["text-on-hero"]],
  ] as const)("draws %s in the phone's colours on the button radius, pressable", (variant, colours) => {
    expect(classes(variant)).toEqual(
      expect.arrayContaining(["pressable", "rounded-button", "focus-visible:outline-2", ...colours]),
    );
  });

  it("draws the red final button in one pair, the phone's destructiveFinal", () => {
    expect(classes("destructiveFinal")).not.toContain("bg-dont-know");
    expect(classes("destructiveFinal")).not.toContain("text-on-ink");
  });

  it.each([
    ["regular", ["min-h-button", "text-button"]],
    ["cta", ["min-h-cta", "text-button"]],
    ["header", ["min-h-tap-target", "text-label"]],
  ] as const)("sizes %s as the phone's AppButtonSize", (size, sized) => {
    expect(classes("secondary", size)).toEqual(expect.arrayContaining(sized));
  });

  it("rings a focused file input inside a label drawn as a button", () => {
    expect(classes("primary")).toContain("has-focus-visible:outline-2");
  });
});
