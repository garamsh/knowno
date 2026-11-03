import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardScroll } from "../components/card-scroll";
import { GradedFace } from "../components/graded-card";

// jsdom lays nothing out, so the face reports the sizes a browser would: 200 px high, and its
// content's height in each step's type as [heights] says.
const faceHeight = 200;
let heights: Record<string, number> = {};
let scrollTop = 0;

function face() {
  const node = document.querySelector("[data-card-step]");
  if (!(node instanceof HTMLElement)) throw new Error("no face rendered");
  return node;
}

beforeEach(() => {
  scrollTop = 0;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute("data-card-step") ? faceHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    const step = this.getAttribute("data-card-step");
    return step === null ? 0 : (heights[step] ?? 0);
  });
  vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(() => scrollTop);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("a card's face", () => {
  it("keeps a front that fits at the front size there, centred, with no fade", () => {
    heights = { "text-front": 120, "text-deck-name": 100, "text-back": 80, "text-card-body": 60 };
    render(<CardScroll length={5}>짧은 앞면</CardScroll>);

    expect(face().dataset.cardStep).toBe("text-front");
    expect(screen.getByText("짧은 앞면").className).toContain("text-center");
    expect(screen.getByText("짧은 앞면").className).toContain("break-keep");
    expect(document.querySelector("[data-card-fade]")).toBeNull();
  });

  it("steps a front down to the first size it fits whole, still centred", () => {
    heights = { "text-front": 320, "text-deck-name": 250, "text-back": 180, "text-card-body": 150 };
    render(<CardScroll length={5}>중간 앞면</CardScroll>);

    expect(face().dataset.cardStep).toBe("text-back");
    expect(screen.getByText("중간 앞면").className).toContain("text-center");
    expect(document.querySelector("[data-card-fade]")).toBeNull();
  });

  it("starts a longer front at a smaller step though a larger one fits, never below the body size (#635)", () => {
    // Every step fits, so only the length moves the size.
    heights = { "text-front": 120, "text-deck-name": 100, "text-back": 80, "text-card-body": 60 };
    for (const [length, step] of [
      [5, "text-front"],
      [12, "text-front"],
      [30, "text-deck-name"],
      [60, "text-back"],
      [100, "text-back"],
      [300, "text-card-body"],
      [5000, "text-card-body"],
    ] as const) {
      const { unmount } = render(<CardScroll length={length}>앞면</CardScroll>);
      expect(face().dataset.cardStep, String(length)).toBe(step);
      unmount();
    }
  });

  it("past the body size scrolls start-aligned with a fading edge, which goes at the end", () => {
    heights = { "text-front": 900, "text-deck-name": 800, "text-back": 600, "text-card-body": 500 };
    render(<CardScroll length={300}>긴 앞면</CardScroll>);

    expect(face().dataset.cardStep).toBe("text-card-body");
    expect(face().className).toContain("overflow-y-auto");
    expect(screen.getByText("긴 앞면").className).toContain("text-start");
    expect(document.querySelector("[data-card-fade]")).not.toBeNull();

    // Scrolled to its last line, nothing more is below.
    scrollTop = heights["text-card-body"] ?? 0;
    scrollTop -= faceHeight;
    fireEvent.scroll(face());
    expect(document.querySelector("[data-card-fade]")).toBeNull();
  });

  it("fits a front again when the card narrows while it holds the front size", () => {
    // jsdom has no ResizeObserver, so this one hands the test the callback a browser would call.
    let resized: (() => void) | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    let frameWidth = 720;
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(() => frameWidth);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => faceHeight);
    heights = { "text-front": 120, "text-deck-name": 100, "text-back": 80, "text-card-body": 60 };
    render(<CardScroll length={5}>좁아지는 앞면</CardScroll>);
    expect(face().dataset.cardStep).toBe("text-front");

    // At 350 px the front wraps to more lines than the face holds at the front size.
    frameWidth = 350;
    heights = { "text-front": 320, "text-deck-name": 250, "text-back": 180, "text-card-body": 150 };
    act(() => {
      resized?.();
    });

    expect(face().dataset.cardStep).toBe("text-back");
  });
});

describe("a previous card's face (#635)", () => {
  it("starts a front over its back at its length's step, never above the title size, and a whole card's face as the current card's", () => {
    // Every step fits, so only the length and the cap move the size.
    heights = { "text-front": 120, "text-deck-name": 100, "text-back": 80, "text-card-body": 60 };
    for (const [length, back, step] of [
      [5, "뒷면", "text-deck-name"],
      [30, "뒷면", "text-deck-name"],
      [60, "뒷면", "text-back"],
      [300, "뒷면", "text-card-body"],
      [5, undefined, "text-front"],
      [60, undefined, "text-back"],
    ] as const) {
      const { unmount } = render(
        <GradedFace answer="know" length={length} front="앞면" back={back} />,
      );
      expect(face().dataset.cardStep, `${String(length)} ${String(back)}`).toBe(step);
      expect(screen.getByText("앞면").className).toContain(step);
      unmount();
    }
  });

  it("steps the front down until it fits with its back, which keeps the body size, and past the body size scrolls with a fading edge", () => {
    heights = { "text-front": 400, "text-deck-name": 300, "text-back": 180, "text-card-body": 150 };
    const { unmount } = render(
      <GradedFace answer="dontKnow" length={30} front="앞면" back="뒷면" />,
    );
    expect(face().dataset.cardStep).toBe("text-back");
    expect(screen.getByText("앞면").className).toContain("text-back");
    expect(screen.getByText("뒷면").className).toContain("text-card-body");
    expect(document.querySelector("[data-card-fade]")).toBeNull();
    unmount();

    heights = { "text-front": 900, "text-deck-name": 800, "text-back": 600, "text-card-body": 500 };
    render(<GradedFace answer="dontKnow" length={30} front="긴 앞면" back="뒷면" />);
    expect(face().dataset.cardStep).toBe("text-card-body");
    expect(screen.getByText("긴 앞면").className).toContain("text-start");
    expect(document.querySelector("[data-card-fade]")).not.toBeNull();
  });
});
