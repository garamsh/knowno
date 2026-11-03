import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DailyMinutes } from "../components/daily-minutes";
import { unknownPace } from "../study-time";

describe("the daily minutes dialog", () => {
  it("keeps Tab and Shift+Tab inside it, starts on the chosen minutes and gives the focus back on close", async () => {
    render(
      <>
        <DailyMinutes
          minutes={20}
          plan={{
            due: 0,
            started: 0,
            unstarted: 30,
            backlog: false,
            pace: unknownPace,
          }}
        />
        <button type="button">뒤의 버튼</button>
      </>,
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "하루 학습 시간 20분" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "하루 학습 시간" });
    expect(dialog).toHaveAccessibleDescription("복습을 먼저 하고, 남는 시간에 새 카드를 시작해요.");
    const controls = within(dialog).getAllByRole("button");
    const [first] = controls;
    const last = controls.at(-1);
    expect(
      within(dialog).getByRole("button", { name: "하루 20분, 눌러서 직접 입력" }),
    ).toHaveFocus();

    last?.focus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
    // Control: inside the dialog, Tab still moves on from a control that is not the last.
    await user.tab({ shift: true });
    expect(controls.at(-2)).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
