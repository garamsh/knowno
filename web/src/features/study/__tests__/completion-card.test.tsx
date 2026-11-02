import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { layOutLines, zoomOf } from "@/testing/line-widths";

import { CompletionCard } from "../components/completion-card";

describe("the completion panel's tiles", () => {
  let restore = () => {};
  afterEach(() => {
    restore();
  });

  const panel = () =>
    render(
      <CompletionCard
        completion={{ knowCount: 1234, dontKnowCount: 5, timeSpentMs: 60_000, streak: 2 }}
        onStudyOn={null}
        back="/"
        onStop={() => {}}
      />,
    );

  it("shrinks a count wider than its tile to the tile, on one line, and leaves the others at their size", () => {
    // A 60 px tile: "1234" is 80 px, "5" 20 px and "1분" 40 px.
    restore = layOutLines(60);
    panel();

    expect(zoomOf(screen.getByText("1234"))).toBe(0.75);
    expect(zoomOf(screen.getByText("5"))).toBe(1);
    expect(zoomOf(screen.getByText("1분"))).toBe(1);
  });
});
