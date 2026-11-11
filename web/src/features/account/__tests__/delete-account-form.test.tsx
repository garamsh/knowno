import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DeleteAccountForm } from "../components/delete-account-form";

const deleteAccount = vi.fn<() => Promise<{ error: string | null }>>();

vi.mock("../actions", () => ({ deleteAccount: () => deleteAccount() }));

const sentence =
  "서버의 노트, 카드, 학습 기록이 모두 삭제되고, 다른 사람이 가져간 노트와 Google 계정은 남아요.";
const storeNote =
  "스토어 구독은 계정을 삭제해도 해지되지 않고, 스토어에서 해지하기 전까지 계속 결제돼요.";

async function ask(storePlan: boolean) {
  render(<DeleteAccountForm storePlan={storePlan} />);
  await userEvent.click(screen.getByRole("button", { name: "계정 삭제" }));
  return screen.getByRole("dialog", { name: "계정을 삭제할까요?" });
}

describe("DeleteAccountForm", () => {
  beforeEach(() => {
    deleteAccount.mockReset();
  });

  it("draws a red row and asks nothing of the server before the confirmation", async () => {
    render(<DeleteAccountForm storePlan={false} />);
    const row = screen.getByRole("button", { name: "계정 삭제" });
    expect(row).toHaveClass("text-dont-know-text");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(row);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(deleteAccount).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it("asks with the sentence, then 취소 and a red 삭제 last, and adds nothing about a store without a store plan", async () => {
    const dialog = await ask(false);

    expect(dialog).toHaveAccessibleDescription(sentence);
    const buttons = within(dialog)
      .getAllByRole("button")
      .filter((button) => button.textContent !== "");
    expect(buttons.map((button) => button.textContent)).toEqual(["취소", "삭제"]);
    expect(buttons[1]).toHaveClass("bg-dont-know-text");
    expect(within(dialog).queryByText(storeNote)).not.toBeInTheDocument();
  });

  it("says a failure in the dialog, which stays open, and forgets it when asked again", async () => {
    deleteAccount.mockResolvedValue({ error: "계정을 삭제하지 못했어요. 다시 시도해 주세요." });
    const dialog = await ask(false);
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "삭제" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "계정을 삭제하지 못했어요. 다시 시도해 주세요.",
    );
    expect(await within(dialog).findByRole("button", { name: "삭제" })).toBeEnabled();

    await userEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    await userEvent.click(screen.getByRole("button", { name: "계정 삭제" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // Last: a deletion that never answers holds React's async transitions for the rest of the file.
  it("adds that a store subscription is not cancelled on a store plan, with no button for it, and still deletes", async () => {
    deleteAccount.mockReturnValue(new Promise(() => undefined));
    const dialog = await ask(true);

    expect(within(dialog).getByText(storeNote)).toBeVisible();
    expect(
      within(dialog)
        .getAllByRole("button")
        .filter((button) => button.textContent !== "")
        .map((button) => button.textContent),
    ).toEqual(["취소", "삭제"]);

    await userEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  it("shows progress and cannot be pressed again while it runs", async () => {
    deleteAccount.mockReturnValue(new Promise(() => undefined));
    const dialog = await ask(false);
    const button = within(dialog).getByRole("button", { name: "삭제" });
    // Control: before the press it is ready.
    expect(button).toBeEnabled();

    await userEvent.click(button);

    const busy = within(dialog).getByRole("button", { name: "삭제 중" });
    expect(busy).toBeDisabled();
    await userEvent.click(busy);
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });
});
