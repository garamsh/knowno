import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render } from "@/testing/render";
import { testRouter } from "@/testing/router";

import { markAnswerSaved } from "../answer-saved";
import { StudyStateRead } from "../components/study-state-read";

const requestTime = 5_000_000;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(requestTime);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("StudyStateRead", () => {
  it("draws the page's content and reads it again only for an answer stored after the request", async () => {
    await render(StudyStateRead, { children: <p>홈의 내용</p> });
    expect(screen.getByText("홈의 내용", { exact: true })).toBeInTheDocument();

    act(() => {
      markAnswerSaved(requestTime - 1);
    });
    expect(testRouter.refresh).not.toHaveBeenCalled();
    // Control: one stored after the request's time reads the page again.
    act(() => {
      markAnswerSaved(requestTime + 1);
    });
    expect(testRouter.refresh).toHaveBeenCalledTimes(1);
  });
});
