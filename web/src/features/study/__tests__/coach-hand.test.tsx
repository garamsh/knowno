import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { coachHand } from "../components/coach-hand-drawing";
import { CoachDemo, CoachSample } from "../components/study-coach";

/** The hand's paths, drawn by the coach's touch inside [touch]. */
function handPaths(touch: HTMLElement) {
  const hand = within(touch).getByTestId("coach-hand");
  return {
    face: hand.querySelector(`path[d="${coachHand.outline}"].fill-surface`),
    edge: hand.querySelector(`path[d="${coachHand.outline}"].fill-edge`),
    creases: hand.querySelector(`path[d="${coachHand.creases}"]`),
  };
}

describe("the coach's hand", () => {
  it("draws the brand's hand from its generated paths, in the surface on its edge with its creases, on a demonstrated card and on the sample", () => {
    render(
      <>
        <CoachDemo answer="know" touch>
          <p>chat</p>
        </CoachDemo>
        <CoachSample touch />
      </>,
    );

    for (const touch of screen.getAllByTestId("coach-touch")) {
      const paths = handPaths(touch);
      expect(paths.face).not.toBeNull();
      expect(paths.edge?.getAttribute("transform")).toBe(
        `translate(${String(coachHand.edge.x)} ${String(coachHand.edge.y)})`,
      );
      expect(paths.creases).not.toBeNull();
    }
    expect(screen.getAllByTestId("coach-touch")).toHaveLength(2);
  });
});
