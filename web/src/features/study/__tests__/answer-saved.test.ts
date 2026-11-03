import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the saved-answer store", () => {
  it("holds no time until an answer is saved, then the time of the last one", async () => {
    const { answerSavedAt, markAnswerSaved } = await import("../answer-saved");
    expect(answerSavedAt()).toBeNull();
    markAnswerSaved();
    vi.setSystemTime(1_005_000);
    markAnswerSaved();
    expect(answerSavedAt()).toBe(1_005_000);
  });

  it("tells each listener of every saved answer until it stops listening", async () => {
    const { markAnswerSaved, subscribeAnswerSaved } = await import("../answer-saved");
    const heard = vi.fn();
    const stop = subscribeAnswerSaved(heard);
    markAnswerSaved();
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    markAnswerSaved();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
