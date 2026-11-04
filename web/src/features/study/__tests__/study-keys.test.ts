import { describe, expect, it } from "vitest";

import { shortcut } from "../hooks/use-study-keys";

const press = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("the study screen's keys", () => {
  it("asks for help and to leave whatever the session's state", () => {
    expect(shortcut(press({ key: "?" }), false, false)).toBe("help");
    expect(shortcut(press({ key: "Escape" }), false, false)).toBe("leave");
  });

  it("answers by the arrows only while a card is studied", () => {
    expect(shortcut(press({ key: "ArrowRight" }), true, false)).toBe("know");
    expect(shortcut(press({ key: "ArrowLeft" }), true, false)).toBe("dontKnow");
    expect(shortcut(press({ key: "ArrowRight" }), false, false)).toBeNull();
    expect(shortcut(press({ key: "ArrowLeft" }), false, false)).toBeNull();
  });

  it("changes the last answer by Z's physical key, in any input language, once one is given", () => {
    expect(shortcut(press({ key: "z", code: "KeyZ" }), true, true)).toBe("toggleLast");
    expect(shortcut(press({ key: "ㅋ", code: "KeyZ" }), true, true)).toBe("toggleLast");
    expect(shortcut(press({ key: "ㅋ", code: "KeyZ" }), true, false)).toBeNull();
    expect(shortcut(press({ key: "z", code: "KeyY" }), true, true)).toBeNull();
  });
});
