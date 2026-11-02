import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Mascot, type MascotExpression } from "@/design/brand";

/** The page's one IntersectionObserver stand-in: what it observes, and whether it was let go. */
const observers: {
  callback: IntersectionObserverCallback;
  observed: Element[];
  disconnected: boolean;
}[] = [];

class FakeIntersectionObserver {
  private readonly own: (typeof observers)[number];
  constructor(callback: IntersectionObserverCallback) {
    this.own = { callback, observed: [], disconnected: false };
    observers.push(this.own);
  }
  observe(element: Element) {
    this.own.observed.push(element);
  }
  disconnect() {
    this.own.disconnected = true;
  }
}

/** Reports the mascot [width] px wide, on screen or not, to the observer watching it now. */
function show(width: number, onScreen = true) {
  const live = observers.filter((o) => !o.disconnected);
  expect(live).toHaveLength(1);
  const [observer] = live;
  const target = observer?.observed.at(-1);
  if (!observer || !target) throw new Error("no observer watches the mascot");
  act(() => {
    observer.callback(
      [
        {
          target,
          isIntersecting: onScreen,
          boundingClientRect: { width } as DOMRectReadOnly,
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
  });
}

/** The system's reduce motion setting, which a test turns on and off. */
const reduce = { on: false, changed: new Set<EventListenerOrEventListenerObject>() };

function setReduceMotion(on: boolean) {
  reduce.on = on;
  const event = new Event("change");
  act(() => {
    for (const changed of reduce.changed) {
      if (typeof changed === "function") changed(event);
      else changed.handleEvent(event);
    }
  });
}

const still = () => document.querySelector("img");
const moving = () => document.querySelector("svg.mascot");

function mascot(expression: MascotExpression) {
  return render(<Mascot expression={expression} className="size-mascot-medium" />);
}

beforeEach(() => {
  vi.useFakeTimers();
  observers.length = 0;
  reduce.on = false;
  reduce.changed.clear();
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  // The code under test reads `matches` and listens for changes; the deprecated addListener and
  // removeListener are left out of the stand-in.
  vi.stubGlobal(
    "matchMedia",
    (query: string): Omit<MediaQueryList, "addListener" | "removeListener"> => ({
      get matches() {
        return query === "(prefers-reduced-motion: reduce)" && reduce.on;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, changed: EventListenerOrEventListenerObject) => {
        reduce.changed.add(changed);
      },
      removeEventListener: (_: string, changed: EventListenerOrEventListenerObject) => {
        reduce.changed.delete(changed);
      },
      dispatchEvent: () => false,
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Mascot", () => {
  it("is its still file until it is seen on screen", () => {
    mascot("thinking");
    expect(still()?.getAttribute("src")).toContain("knowno-thinking.svg");
    expect(still()?.getAttribute("alt")).toBe("");
    expect(moving()).toBeNull();
  });

  it("on screen at 200 px breathes inline, hidden from screen readers, and blinks", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    mascot("thinking");
    show(200);

    const svg = moving();
    expect(svg?.getAttribute("data-motion")).toBe("full");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.querySelector(".breath .eye")).not.toBeNull();
    expect(still()).toBeNull();

    // A roll of 0.5 waits 5 s and blinks once, shut for 110 ms.
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(svg?.getAttribute("data-eyes")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(svg?.getAttribute("data-eyes")).toBe("shut");
    act(() => {
      vi.advanceTimersByTime(110);
    });
    expect(svg?.getAttribute("data-eyes")).toBeNull();
  });

  it("holds a sad blink for 160 ms", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    mascot("sad");
    show(96);
    act(() => {
      vi.advanceTimersByTime(5000 + 159);
    });
    expect(moving()?.getAttribute("data-eyes")).toBe("shut");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(moving()?.getAttribute("data-eyes")).toBeNull();
  });

  it("moves by its size: still at 40 px, a blink alone from 41 px, everything from 200 px", () => {
    const sizes: [MascotExpression, number, string | null][] = [
      ["thinking", 40, null],
      ["thinking", 41, "blink"],
      ["sad", 199, "blink"],
      ["happy", 199, null],
      ["sleepy", 199, null],
      ["thinking", 200, "full"],
      ["happy", 200, "full"],
      ["sleepy", 200, "full"],
    ];
    for (const [expression, width, motion] of sizes) {
      observers.length = 0;
      const { unmount } = mascot(expression);
      show(width);
      expect(
        moving()?.getAttribute("data-motion") ?? null,
        `${expression} at ${String(width)}`,
      ).toBe(motion);
      unmount();
    }
  });

  it("under reduce motion is its still file, and nothing moves or waits to", () => {
    setReduceMotion(true);
    mascot("thinking");
    // Asked for reduced motion, it watches nothing and waits for no blink.
    expect(observers).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(moving()).toBeNull();
    expect(still()).not.toBeNull();

    // Control: with reduce motion off, the same mascot on screen moves.
    setReduceMotion(false);
    show(200);
    expect(moving()?.getAttribute("data-motion")).toBe("full");

    // Turned on while it moves, it stops at once.
    setReduceMotion(true);
    expect(moving()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops off screen, and leaves no observer or timer once gone", () => {
    const { unmount } = mascot("thinking");
    show(200);
    expect(moving()).not.toBeNull();
    expect(vi.getTimerCount()).toBe(1);

    show(200, false);
    expect(moving()).toBeNull();
    expect(still()).not.toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    show(200);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });
});
