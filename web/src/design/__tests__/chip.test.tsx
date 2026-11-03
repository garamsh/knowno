import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Chip } from "../chip";

describe("the one chip", () => {
  it.each([
    ["neutral", ["bg-surface", "border-outline", "text-ink"]],
    ["brand", ["bg-brand-tint", "border-brand-tint", "text-ink"]],
    ["amber", ["bg-tint-amber", "border-tint-amber", "text-ink"]],
    ["know", ["bg-know", "border-know", "text-on-know"]],
    ["knowTint", ["bg-tint-green", "border-tint-green", "text-on-know-tint"]],
    ["dontKnow", ["bg-dont-know-text", "border-dont-know-text", "text-on-dont-know-text"]],
  ] as const)(
    "draws the %s tone in the phone's fill, line and text, on the chip radius in the section type",
    (tone, colours) => {
      render(<Chip tone={tone}>words</Chip>);

      const chip = screen.getByText("words");
      expect(chip.className.split(" ")).toEqual(
        expect.arrayContaining([
          "rounded-chip",
          "text-section",
          "px-3",
          "py-1",
          "border",
          ...colours,
        ]),
      );
    },
  );

  it("puts a leading mark before its words", () => {
    render(<Chip leading={<svg data-testid="mark" />}>1일 연속</Chip>);

    const chip = screen.getByText("1일 연속");
    expect(chip.firstElementChild).toBe(screen.getByTestId("mark"));
  });
});
