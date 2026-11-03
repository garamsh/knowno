import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Confirm } from "../confirm";

describe("the confirm", () => {
  it("asks in its title, states the consequence, and puts the cancel, focused, above the red final button", async () => {
    render(
      <Confirm
        title="노트를 삭제할까요?"
        consequence="카드 3장도 함께 삭제돼요."
        confirmLabel="삭제"
        destructive
        onConfirm={vi.fn()}
        close={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "노트를 삭제할까요?" });
    expect(dialog).toHaveTextContent("카드 3장도 함께 삭제돼요.");
    const [cancel, confirm] = within(dialog)
      .getAllByRole("button")
      .filter((button) => button.textContent !== "");
    expect(cancel).toHaveAccessibleName("취소");
    expect(confirm).toHaveAccessibleName("삭제");
    expect(confirm).toHaveClass("bg-dont-know-text", "text-on-dont-know-text");
    expect(cancel).toHaveClass("bg-surface");
    await waitFor(() => {
      expect(cancel).toHaveFocus();
    });
  });

  it("confirms in the primary where the action is not destructive, under the cancel the caller names", () => {
    render(
      <Confirm
        title="연결할까요?"
        consequence="노트를 읽을 수 있어요."
        confirmLabel="연결"
        cancelLabel="계속 쓰기"
        destructive={false}
        onConfirm={vi.fn()}
        close={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "연결" })).toHaveClass("bg-primary");
    expect(screen.getByRole("button", { name: "계속 쓰기" })).toBeInTheDocument();
  });

  it("confirms once by its button and cancels by the cancel, never the other way", async () => {
    const onConfirm = vi.fn();
    const close = vi.fn();
    render(
      <Confirm
        title="버릴까요?"
        consequence="사라져요."
        confirmLabel="버리기"
        destructive
        onConfirm={onConfirm}
        close={close}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "취소" }));
    expect(close).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "버리기" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("holds the confirm while a press is under way", () => {
    render(
      <Confirm
        title="버릴까요?"
        consequence="사라져요."
        confirmLabel="버리기"
        destructive
        pending
        onConfirm={vi.fn()}
        close={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "버리기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "취소" })).toBeEnabled();
  });
});
