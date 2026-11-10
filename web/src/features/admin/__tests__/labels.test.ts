import { describe, expect, it } from "vitest";

import { labelOf, reasonLabels } from "../labels";

describe("the report reasons", () => {
  it("names sexual in the app's words, with an existing reason as the control", () => {
    expect(labelOf(reasonLabels, "sexual")).toBe("성적인 내용·미성년자");
    // Control: a reason the label map already held reads as before, and an unknown one as itself.
    expect(labelOf(reasonLabels, "spam")).toBe("스팸");
    expect(labelOf(reasonLabels, "unheard_of")).toBe("unheard_of");
  });
});
