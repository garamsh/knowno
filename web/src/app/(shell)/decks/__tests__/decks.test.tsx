import { describe, expect, it } from "vitest";

import { redirectTarget } from "@/testing/redirect";

import DecksPage from "../page";

describe("/decks", () => {
  it("opens 홈, where the notes now are, for an address kept from the 노트 tab", async () => {
    expect(await redirectTarget(Promise.resolve().then(DecksPage))).toBe("/");
  });
});
