import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { layOutLines, zoomOf } from "@/testing/line-widths";

import { FittedLine } from "../fitted-line";

describe("a line fitted to its column", () => {
  let restore = () => {};
  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  it("shrinks a figure wider than its column to the column, on one line, and leaves a narrower one at its size", () => {
    // 12 characters, 240 px, in a 120 px column.
    restore = layOutLines(120);
    render(
      <>
        <FittedLine>123456789012</FittedLine>
        <FittedLine>123</FittedLine>
      </>,
    );

    const wide = screen.getByText("123456789012");
    expect(zoomOf(wide)).toBe(0.5);
    expect(wide).toHaveClass("whitespace-nowrap");
    // Control: 60 px fits the column, so it keeps its style's size.
    expect(zoomOf(screen.getByText("123"))).toBe(1);
  });

  it("fits again when its column narrows and widens", () => {
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
    restore = layOutLines(300);
    render(<FittedLine>1234567890</FittedLine>);
    const line = screen.getByText("1234567890");
    expect(zoomOf(line)).toBe(1);

    restore();
    restore = layOutLines(100);
    act(() => {
      resized?.();
    });
    expect(zoomOf(line)).toBe(0.5);

    restore();
    restore = layOutLines(400);
    act(() => {
      resized?.();
    });
    expect(zoomOf(line)).toBe(1);
  });
});
