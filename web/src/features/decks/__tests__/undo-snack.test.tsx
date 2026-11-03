import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UndoSnack } from "../components/editing";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the editor's snack", () => {
  it("says what was deleted with 되돌리기, and goes after four seconds", () => {
    const dismiss = vi.fn();
    const undo = vi.fn();
    render(<UndoSnack said="칸을 삭제했어요" undo={undo} dismiss={dismiss} />);
    expect(screen.getByRole("status")).toHaveTextContent("칸을 삭제했어요");
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(dismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(dismiss).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    expect(undo).toHaveBeenCalledOnce();
  });

  it("stays while the focus is on it, and goes four seconds after the focus leaves", () => {
    const dismiss = vi.fn();
    render(<UndoSnack said="뜻을 삭제했어요" undo={vi.fn()} dismiss={dismiss} />);
    act(() => {
      screen.getByRole("button", { name: "되돌리기" }).focus();
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(dismiss).not.toHaveBeenCalled();
    act(() => {
      screen.getByRole("button", { name: "되돌리기" }).blur();
    });
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(dismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
