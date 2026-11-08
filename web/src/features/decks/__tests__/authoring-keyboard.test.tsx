import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { uuidOf } from "@/testing/library";
import { addByHand } from "@/testing/add-by-hand";
import { render } from "@/testing/render";

import { NoteSettings } from "../components/note-settings";
import { parseDeckId } from "../library";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const deckId = parseDeckId(uuidOf("deck"));
if (!deckId) throw new Error("fixture ids");
const deck = { id: deckId, name: "단어장", public: false };

/** The part of the page a browser shows, which jsdom lacks: 844 px high from the top at first. */
class VisibleArea extends EventTarget {
  height = 844;
  offsetTop = 0;
  /** An on-screen keyboard rising to [keyboard] px, with the page panned down by [panned]. */
  keyboard(keyboard: number, panned: number) {
    this.height = 844 - keyboard;
    this.offsetTop = panned;
    this.dispatchEvent(new Event("resize"));
    this.dispatchEvent(new Event("scroll"));
  }
}
let area: VisibleArea;
beforeEach(() => {
  area = new VisibleArea();
  vi.stubGlobal("visualViewport", area);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The place [dialog] is drawn in: the top and the height of the part of the page shown. */
const placeOf = (dialog: HTMLElement) => ({
  top: dialog.style.getPropertyValue("--visible-top"),
  height: dialog.style.getPropertyValue("--visible-height"),
});

describe("an authoring screen and sheet over an on-screen keyboard", () => {
  it("keep their foot in the part of the page shown, which the keyboard shrinks, as the phone's sit above it", async () => {
    await render(() => <NoteSettings deck={deck} cardCount={0} displayName={{ name: null }} />, {});
    await addByHand();
    const sheet = screen.getByRole("dialog", { name: "카드 추가" });
    // Control: with no keyboard, the whole page.
    expect(placeOf(sheet)).toEqual({ top: "0px", height: "844px" });
    act(() => {
      area.keyboard(336, 120);
    });
    expect(placeOf(sheet)).toEqual({ top: "120px", height: "508px" });

    await userEvent.click(screen.getByRole("button", { name: "직접 입력" }));
    const editor = screen.getByRole("dialog", { name: "새 카드" });
    expect(placeOf(editor)).toEqual({ top: "120px", height: "508px" });
    act(() => {
      area.keyboard(0, 0);
    });
    expect(placeOf(editor)).toEqual({ top: "0px", height: "844px" });
  });
});
