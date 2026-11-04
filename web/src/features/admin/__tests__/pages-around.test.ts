import { describe, expect, it } from "vitest";

import { pagesAround } from "../components/admin-table";

describe("pagesAround", () => {
  it("offers every page while there are few", () => {
    expect(pagesAround(1, 1)).toEqual([1]);
    expect(pagesAround(2, 3)).toEqual([1, 2, 3]);
  });

  it("offers the first, the last and the two beside the current one, a gap between", () => {
    expect(pagesAround(1, 65)).toEqual([1, 2, "gap", 65]);
    expect(pagesAround(30, 65)).toEqual([1, "gap", 29, 30, 31, "gap", 65]);
    expect(pagesAround(65, 65)).toEqual([1, "gap", 64, 65]);
  });

  it("shows the one page a gap would hide in its place", () => {
    expect(pagesAround(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pagesAround(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pagesAround(5, 9)).toEqual([1, "gap", 4, 5, 6, "gap", 9]);
  });
});
