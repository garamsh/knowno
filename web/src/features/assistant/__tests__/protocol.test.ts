import { describe, expect, it } from "vitest";

import { leftShare, parseEvent, parsePoll, parseRefusal } from "../protocol";

export const proposalData = {
  id: "p1",
  kind: "cards",
  deck: { id: null, name: "영단어" },
  groups: [
    {
      id: "g1",
      title: "1단원",
      format: "senses",
      cards: [{ id: "c1", card: { front: "apple", back: "사과" } }],
    },
  ],
};

describe("reading the assistant's events", () => {
  it("reads each event the function sends into its form", () => {
    expect(parseEvent("text", '{"delta":"안녕"}')).toEqual({ type: "text", delta: "안녕" });
    expect(parseEvent("citation", '{"url":"https://a.test","title":"A"}')).toEqual({
      type: "citation",
      url: "https://a.test",
      title: "A",
    });
    expect(parseEvent("choice", '{"prompt":"형식은?","options":["단어","표"]}')).toEqual({
      type: "choice",
      choice: { prompt: "형식은?", options: ["단어", "표"] },
    });
    expect(parseEvent("job", '{"id":"j1","photos":3,"status":"running"}')).toEqual({
      type: "job",
      id: "j1",
      photos: 3,
    });
    expect(parseEvent("error", '{"error":"cut"}')).toEqual({ type: "error", error: "cut" });
    expect(parseEvent("interim", "{}")).toEqual({ type: "interim" });
    expect(
      parseEvent(
        "usage",
        '{"outcome":"ok","token_budget":200000,"tokens_used":5000,"input_tokens":1}',
      ),
    ).toEqual({
      type: "usage",
      allowance: { tokenBudget: 200000, tokensUsed: 5000 },
      atLimit: false,
    });
    for (const outcome of ["depth_limit", "time_limit"])
      expect(
        parseEvent("usage", `{"outcome":"${outcome}","token_budget":null,"tokens_used":5}`),
      ).toMatchObject({ type: "usage", atLimit: true });
    expect(parseEvent("usage", '{"token_budget":null,"tokens_used":5}')).toEqual({
      type: "usage",
      allowance: { tokenBudget: null, tokensUsed: 5 },
      atLimit: false,
    });
    const proposal = parseEvent("proposal", JSON.stringify(proposalData));
    expect(proposal).toEqual({ type: "proposal", proposal: proposalData });
  });

  it("passes over an event it does not draw, and marks a known one that is not its form", () => {
    expect(parseEvent("thinking", "{}")).toBe("unknown");
    expect(parseEvent("text", "not json")).toBe("malformed");
    expect(parseEvent("interim", "[]")).toBe("malformed");
    expect(parseEvent("text", '{"delta":3}')).toBe("malformed");
    expect(parseEvent("error", '{"error":"other"}')).toBe("malformed");
    expect(parseEvent("job", '{"id":"j1"}')).toBe("malformed");
    // A group in a form no card takes, and a card without its card.
    const badFormat = { ...proposalData, groups: [{ ...proposalData.groups[0], format: "csv" }] };
    expect(parseEvent("proposal", JSON.stringify(badFormat))).toBe("malformed");
    const badCard = {
      ...proposalData,
      groups: [{ ...proposalData.groups[0], cards: [{ id: "c1" }] }],
    };
    expect(parseEvent("proposal", JSON.stringify(badCard))).toBe("malformed");
  });
});

describe("reading a photo job's poll", () => {
  const poll = (status: string, photos: string[]) => ({
    id: "j1",
    status,
    photos: photos.map((photo, position) => ({
      position,
      photo_id: `p${String(position)}`,
      status: photo,
    })),
    queued: photos.filter((photo) => photo === "queued").length,
  });

  it("counts the photos no longer queued as finished, whether read, failed or skipped", () => {
    expect(parsePoll(poll("running", ["read", "failed", "skipped", "queued", "queued"]))).toEqual({
      id: "j1",
      photos: 5,
      finished: 3,
      state: "running",
    });
    expect(parsePoll(poll("done", ["read", "read"]))?.state).toBe("done");
    expect(parsePoll(poll("cancelled", ["cancelled", "read"]))?.state).toBe("cancelled");
  });

  it("reads a body that is no poll as none", () => {
    expect(parsePoll({ ...poll("running", ["read"]), status: "lost" })).toBeNull();
    expect(parsePoll({ id: "j1", status: "running", photos: [{}] })).toBeNull();
    expect(parsePoll(null)).toBeNull();
  });
});

describe("reading a refused message", () => {
  it("tells a spent budget from a message still running, and keeps the day's tokens", () => {
    expect(
      parseRefusal(429, { error: "rate_limited", token_budget: 200000, tokens_used: 200400 }),
    ).toEqual({ kind: "rate_limited", allowance: { tokenBudget: 200000, tokensUsed: 200400 } });
    expect(parseRefusal(429, { error: "busy" })).toEqual({ kind: "busy" });
    expect(parseRefusal(401, { error: "unauthenticated" })).toEqual({ kind: "signIn" });
    expect(parseRefusal(403, { error: "suspended" })).toEqual({ kind: "suspended" });
    expect(parseRefusal(413, { error: "too_large" })).toEqual({ kind: "tooLong" });
    expect(parseRefusal(503, { error: "not_configured" })).toEqual({ kind: "unavailable" });
    expect(parseRefusal(502, null)).toEqual({ kind: "unavailable" });
  });
});

describe("the share of the day left", () => {
  it("is the budget's whole percent left, none past it, and null with no budget", () => {
    expect(leftShare({ tokenBudget: 200000, tokensUsed: 72000 })).toBe(64);
    expect(leftShare({ tokenBudget: 200000, tokensUsed: 250000 })).toBe(0);
    expect(leftShare({ tokenBudget: null, tokensUsed: 9 })).toBeNull();
  });
});
