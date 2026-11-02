import { describe, expect, it } from "vitest";

import type { BoxDraft } from "../authoring";
import { minBoxSide, movedBox, newBox, resizedBox, withBox } from "../photo-boxes";

const box = (id: string, x = 0.1, y = 0.1, w = 0.2, h = 0.2): BoxDraft => ({
  id,
  x,
  y,
  w,
  h,
  answer: "",
});

describe("a photo's boxes, edited as the phone's ImageDraft", () => {
  it("gives a new box one more than the highest number among the ids, a non-number counting as 0", () => {
    expect(withBox([], newBox).map(({ id }) => id)).toEqual(["1"]);
    expect(withBox([box("2"), box("x"), box("7")], newBox).at(-1)?.id).toBe("8");
    expect(withBox([box("3a")], newBox).at(-1)?.id).toBe("1");
  });

  it("keeps a box inside the photo and no smaller than the least side", () => {
    expect(withBox([], { x: 0.9, y: 0.95, w: 0.3, h: 0.001 })[0]).toMatchObject({
      x: 0.7,
      y: 0.95,
      w: 0.3,
      h: minBoxSide,
    });
    expect(movedBox([box("1", 0.7, 0.7)], 0, 0.5, -0.9)[0]).toMatchObject({ x: 0.8, y: 0 });
    expect(resizedBox([box("1", 0.5, 0.5)], 0, 0.9, -0.9)[0]).toMatchObject({
      w: 0.5,
      h: minBoxSide,
    });
  });

  it("moves and resizes the box at its index alone, against the others", () => {
    const boxes = [box("1"), box("2", 0.5, 0.5)];
    const moved = movedBox(boxes, 1, 0.05, 0);
    expect(moved[0]).toEqual(boxes[0]);
    expect(moved[1]?.x).toBeCloseTo(0.55);
    const grown = resizedBox(boxes, 0, 0, 0.05);
    expect(grown[1]).toEqual(boxes[1]);
    expect(grown[0]?.h).toBeCloseTo(0.25);
  });

  it("clamps a stored box a rounding past the photo before it moves", () => {
    expect(movedBox([box("1", 0.9, 0, 0.2, 0.2)], 0, 0, 0)[0]).toMatchObject({ x: 0.8, w: 0.2 });
  });
});
