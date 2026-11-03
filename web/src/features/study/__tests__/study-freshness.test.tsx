import { act, render } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testRouter } from "@/testing/router";

import { markAnswerSaved } from "../answer-saved";
import { StudyFreshness } from "../components/study-freshness";

/** The App Router hides a page it leaves in an Activity, and shows it again on a back. */
const page = (mode: "visible" | "hidden") => (
  <Activity mode={mode}>
    <StudyFreshness />
  </Activity>
);

function save() {
  act(() => {
    markAnswerSaved();
  });
}

/** Moves the clock a second on. */
function aSecondLater() {
  vi.setSystemTime(Date.now() + 1_000);
}

// The store is this file's own, so each test starts later than every answer an earlier one saved.
let start = 1_000_000;
beforeEach(() => {
  start += 10_000_000;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(start);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("StudyFreshness", () => {
  // First, while the file's store holds no saved answer.
  it("reads nothing again when no answer was saved, though the page hides and shows again", () => {
    const view = render(page("visible"));
    view.rerender(page("hidden"));
    view.rerender(page("visible"));
    expect(testRouter.refresh).not.toHaveBeenCalled();
    // Control: the same page, shown, reads again once an answer lands.
    aSecondLater();
    save();
    expect(testRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("reads the page again once when it shows again after an answer was saved while it was away", () => {
    const view = render(page("visible"));
    view.rerender(page("hidden"));
    aSecondLater();
    save();
    expect(testRouter.refresh).not.toHaveBeenCalled();

    view.rerender(page("visible"));
    expect(testRouter.refresh).toHaveBeenCalledTimes(1);
    // Shown again with nothing saved since, it reads nothing again.
    aSecondLater();
    view.rerender(page("hidden"));
    view.rerender(page("visible"));
    expect(testRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("reads the page again once when an answer still in flight lands while it is shown", () => {
    render(page("visible"));
    aSecondLater();
    save();
    expect(testRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("reads nothing again for an answer saved before the page was first shown", () => {
    save();
    aSecondLater();
    const view = render(page("visible"));
    expect(testRouter.refresh).not.toHaveBeenCalled();
    // Control: one saved later, while the page is away, is read on its return.
    view.rerender(page("hidden"));
    aSecondLater();
    save();
    view.rerender(page("visible"));
    expect(testRouter.refresh).toHaveBeenCalledTimes(1);
  });
});
