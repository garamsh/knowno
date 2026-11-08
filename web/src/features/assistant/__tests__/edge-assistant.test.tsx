import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testRouter } from "@/testing/router";

import { EdgeAssistant, edgeReturnMs } from "../components/edge-assistant";
import { conversationKey, shown, type AssistantTurn } from "../conversation";
import type { Proposal } from "../protocol";

const hintKey = "knowno.assistant.hint";
const sideKey = "knowno.assistant.edge";

const proposal: Proposal = {
  id: "p1",
  kind: "cards",
  deck: { id: null, name: "영단어" },
  groups: [
    {
      id: "g1",
      title: "1단원",
      format: "senses",
      cards: [
        { id: "c1", card: {} },
        { id: "c2", card: {} },
      ],
    },
  ],
};

/** The chat this browser keeps with a proposal shown and not yet added. */
function keepReady() {
  const reply: AssistantTurn = {
    role: "assistant",
    id: "a1",
    text: "만들었어요",
    citations: [],
    proposals: [shown(proposal)],
    choice: null,
    job: null,
    ending: "ok",
  };
  window.localStorage.setItem(
    conversationKey,
    JSON.stringify({ version: 1, turns: [reply], draft: "" }),
  );
}

const character = () => screen.getByRole("button", { name: /^말랑이와 대화하기/ });

beforeEach(() => {
  window.localStorage.clear();
  testRouter.push.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the edge character", () => {
  it("is a button named 말랑이와 대화하기 that opens the chat, from the note it is drawn in", async () => {
    render(<EdgeAssistant noteId="d1" />);
    await userEvent.click(character());
    expect(testRouter.push).toHaveBeenLastCalledWith("/assistant?note=d1");
    cleanup();
    render(<EdgeAssistant />);
    await userEvent.click(character());
    expect(testRouter.push).toHaveBeenLastCalledWith("/assistant");
  });

  it("says the cards ready in a short bubble that joins the button's name, and none without", () => {
    render(<EdgeAssistant />);
    expect(character()).toHaveAccessibleName("말랑이와 대화하기");
    expect(screen.queryByText(/만들어 뒀어요/)).not.toBeInTheDocument();
    cleanup();
    keepReady();
    render(<EdgeAssistant />);
    expect(screen.getByText("2장 만들어 뒀어요")).toBeInTheDocument();
    expect(character()).toHaveAccessibleName("말랑이와 대화하기, 2장 만들어 뒀어요");
    expect(screen.queryByText("카드 2장 만들어 뒀어요")).not.toBeInTheDocument();
  });

  it("keeps the room under the page's last row, and leaves the page while a dialog is open", async () => {
    const { container } = render(<EdgeAssistant />);
    expect(container.querySelector("[aria-hidden][style]")).not.toBeNull();
    const dialog = document.createElement("dialog");
    act(() => {
      document.body.append(dialog);
      dialog.setAttribute("open", "");
    });
    await vi.waitFor(() => {
      expect(screen.queryByRole("button", { name: /^말랑이와 대화하기/ })).not.toBeInTheDocument();
    });
    act(() => {
      dialog.remove();
    });
    await vi.waitFor(() => {
      expect(character()).toBeInTheDocument();
    });
  });

  it("tucks into its edge while the page scrolls, and comes back when it stops", () => {
    vi.useFakeTimers();
    render(<EdgeAssistant />);
    const slide = () => character().querySelector<HTMLElement>("span.block")?.style.transform;
    expect(slide()).toBe("translateX(0px)");
    act(() => {
      fireEvent.scroll(window);
    });
    expect(slide()).toBe("translateX(36px)");
    act(() => {
      vi.advanceTimersByTime(edgeReturnMs - 1);
    });
    expect(slide()).toBe("translateX(36px)");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(slide()).toBe("translateX(0px)");
  });

  it("is dragged to the other edge, which this browser keeps, and a drag is not a tap", () => {
    window.innerWidth = 390;
    render(<EdgeAssistant />);
    const button = character();
    fireEvent.pointerDown(button, { clientX: 340, pointerId: 1 });
    fireEvent.pointerMove(button, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(button, { clientX: 60, pointerId: 1 });
    fireEvent.click(button);
    expect(window.localStorage.getItem(sideKey)).toBe("left");
    expect(testRouter.push).not.toHaveBeenCalled();
    // Control: a press that barely moves is a tap, and leaves the edge as it was.
    fireEvent.pointerDown(button, { clientX: 50, pointerId: 1 });
    fireEvent.pointerUp(button, { clientX: 52, pointerId: 1 });
    fireEvent.click(button);
    expect(testRouter.push).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(sideKey)).toBe("left");
    // The arrow keys move it too, for one who cannot drag.
    fireEvent.keyDown(button, { key: "ArrowRight" });
    expect(window.localStorage.getItem(sideKey)).toBe("right");
    fireEvent.keyDown(button, { key: "ArrowLeft" });
    expect(window.localStorage.getItem(sideKey)).toBe("left");
  });

  it("starts at the edge it was left at, and at the right where none is kept", () => {
    const { container, unmount } = render(<EdgeAssistant />);
    expect(
      container.querySelector(".right-\\[max\\(0\\.75rem\\,env\\(safe-area-inset-right\\)\\)\\]"),
    ).not.toBeNull();
    unmount();
    window.localStorage.setItem(sideKey, "left");
    const left = render(<EdgeAssistant />);
    expect(
      left.container.querySelector(
        ".right-\\[max\\(0\\.75rem\\,env\\(safe-area-inset-right\\)\\)\\]",
      ),
    ).toBeNull();
  });
});

describe("the one-time hint", () => {
  it("shows beside the character where it may, until it is closed, for good", async () => {
    render(<EdgeAssistant hint />);
    expect(screen.getByText("말랑이를 누르면 언제든 대화할 수 있어요")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "안내 닫기" }));
    expect(screen.queryByText("말랑이를 누르면 언제든 대화할 수 있어요")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(hintKey)).toBe("gone");
    cleanup();
    render(<EdgeAssistant hint />);
    expect(screen.queryByText("말랑이를 누르면 언제든 대화할 수 있어요")).not.toBeInTheDocument();
  });

  it("goes for good on tapping 말랑이, and is not shown where no first note exists", async () => {
    render(<EdgeAssistant />);
    // Control: the same page with the hint allowed shows it.
    expect(screen.queryByText("말랑이를 누르면 언제든 대화할 수 있어요")).not.toBeInTheDocument();
    cleanup();
    render(<EdgeAssistant hint />);
    expect(screen.getByText("말랑이를 누르면 언제든 대화할 수 있어요")).toBeInTheDocument();
    await userEvent.click(character());
    expect(screen.queryByText("말랑이를 누르면 언제든 대화할 수 있어요")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(hintKey)).toBe("gone");
  });

  it("gives way to the ready bubble, which says something more to the point", () => {
    keepReady();
    render(<EdgeAssistant hint />);
    expect(screen.getByText("2장 만들어 뒀어요")).toBeInTheDocument();
    expect(screen.queryByText("말랑이를 누르면 언제든 대화할 수 있어요")).not.toBeInTheDocument();
  });

  it("still goes for this page where the browser keeps nothing", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<EdgeAssistant hint />);
    await userEvent.click(screen.getByRole("button", { name: "안내 닫기" }));
    expect(screen.queryByText("말랑이를 누르면 언제든 대화할 수 있어요")).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
