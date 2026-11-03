import { act, render } from "@testing-library/react";
import { Activity } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { testRouter } from "@/testing/router";

import { markAnswerSaved } from "../answer-saved";
import { StudyFreshness } from "../components/study-freshness";

/**
 * The page, read on the server at [readAt]. The App Router hides a page it leaves in an Activity,
 * and shows it again on a back.
 */
const page = (readAt: number, mode: "visible" | "hidden" = "visible") => (
  <Activity mode={mode}>
    <StudyFreshness readAt={readAt} />
  </Activity>
);

/** An answer the server stored at [at]. */
function saved(at: number) {
  act(() => {
    markAnswerSaved(at);
  });
}

// The store is this file's own and keeps the latest time, so each test's times are later than
// every earlier test's.
let read = 0;
beforeEach(() => {
  read += 10_000_000;
});

describe("StudyFreshness", () => {
  // First, while the file's store holds no saved answer.
  it("reads nothing again when no answer was saved, though the page hides and shows again", () => {
    const view = render(page(read));
    view.rerender(page(read, "hidden"));
    view.rerender(page(read));
    expect(testRouter.refresh).not.toHaveBeenCalled();
    // Control: the same page, shown, reads again once an answer stored after its read lands.
    saved(read + 1_000);
    expect(testRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("reads the page again when it first mounts after an answer stored after its data was read", () => {
    // The router evicted the page, and draws it again from its cache, read before the answer.
    saved(read + 1_000);
    render(page(read));
    expect(testRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("reads the page again once when it shows again after an answer landed while it was away", () => {
    const view = render(page(read));
    view.rerender(page(read, "hidden"));
    saved(read + 1_000);
    expect(testRouter.refresh).not.toHaveBeenCalled();

    view.rerender(page(read));
    expect(testRouter.refresh).toHaveBeenCalledTimes(1);
    // Shown again with nothing saved since, it reads nothing again.
    view.rerender(page(read, "hidden"));
    view.rerender(page(read));
    expect(testRouter.refresh).toHaveBeenCalledTimes(1);
    // Read again, at a later time, it asks for nothing more.
    view.rerender(page(read + 2_000));
    expect(testRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("reads the page again once when an answer still in flight lands while it is shown", () => {
    render(page(read));
    saved(read + 1_000);
    expect(testRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("reads nothing again for an answer stored before the page read its data", () => {
    saved(read - 1_000);
    const view = render(page(read));
    expect(testRouter.refresh).not.toHaveBeenCalled();
    // Control: one stored after the read, while the page is away, is read on its return.
    view.rerender(page(read, "hidden"));
    saved(read + 1_000);
    view.rerender(page(read));
    expect(testRouter.refresh).toHaveBeenCalledTimes(1);
  });
});
