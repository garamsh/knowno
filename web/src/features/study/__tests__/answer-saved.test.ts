import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("the saved-answer store", () => {
  it("holds no time until an answer is saved, then the server's time of the latest one", async () => {
    const { answerSavedAt, markAnswerSaved } = await import("../answer-saved");
    expect(answerSavedAt()).toBeNull();
    markAnswerSaved(1_000_000);
    markAnswerSaved(1_005_000);
    expect(answerSavedAt()).toBe(1_005_000);
    // A write that lands later but was stored earlier does not move it back.
    markAnswerSaved(1_002_000);
    expect(answerSavedAt()).toBe(1_005_000);
  });

  it("tells each listener of every saved answer until it stops listening", async () => {
    const { markAnswerSaved, subscribeAnswerSaved } = await import("../answer-saved");
    const heard = vi.fn();
    const stop = subscribeAnswerSaved(heard);
    markAnswerSaved(1_000_000);
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    markAnswerSaved(1_001_000);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
