import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakePostgrest } from "@/testing/mocks/postgrest";
import { testUser } from "@/testing/mocks/handlers";
import { testRouter } from "@/testing/router";
import { server } from "@/testing/mocks/server";
import { cardRow, deckRow, start } from "@/testing/library";
import { layOutLines, zoomOf } from "@/testing/line-widths";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { signedInCookies } from "@/testing/session";

import { Today } from "../../_components/today";
import { Profile } from "../_components/profile";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let postgrest: FakePostgrest;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(start);
  setRequestCookies(await signedInCookies());
  postgrest = new FakePostgrest();
  server.use(...postgrest.handlers);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the daily study minutes", () => {
  /** One deck holding [count] cards never answered. */
  const seedNew = (count: number) => {
    postgrest.seed("decks", deckRow("d-fr", "French"));
    postgrest.seed(
      "cards",
      ...Array.from({ length: count }, (_, index) =>
        cardRow(`new-${String(index)}`, "d-fr", `new ${String(index)}`),
      ),
    );
  };
  const control = (minutes: number) =>
    screen.getByRole("button", { name: `하루 학습 시간 ${String(minutes)}분` });

  it("show under 학습 as a row reading 하루 학습 시간 and the minutes, which opens a dialog", async () => {
    seedNew(3);
    await render(Profile, {});

    const study = screen.getByRole("region", { name: "학습" });
    expect(within(study).getByRole("button", { name: "하루 학습 시간 20분" })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );
    // The row has no icon but its chevron, which a screen reader does not read.
    expect(control(20).querySelectorAll("svg")).toHaveLength(1);
    expect(control(20).querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  /** The dialog the control opened, its tiles, and its number as a button. */
  const openDialog = async (user: ReturnType<typeof userEvent.setup>, minutes = 20) => {
    await user.click(control(minutes));
    const dialog = within(screen.getByRole("dialog", { name: "하루 학습 시간" }));
    return {
      dialog,
      tiles: dialog.getByRole("status"),
      number: (value: number) =>
        dialog.getByRole("button", { name: `하루 ${String(value)}분, 눌러서 직접 입력` }),
      input: () => dialog.getByRole("textbox", { name: "하루 학습 시간(분)" }),
    };
  };

  it("open a dialog of the minutes as one number between − and +, whose tiles follow the number as it is typed, and saving stores them and reads the page again with today's new count", async () => {
    seedNew(150);
    await render(Profile, {});
    const user = userEvent.setup();

    const { dialog, tiles, number, input } = await openDialog(user);
    expect(number(20)).toHaveFocus();
    expect(number(20)).toHaveTextContent("20분");
    expect(tiles).toHaveAttribute("aria-live", "polite");
    // The region holds both tiles, so each tile's title and value is matched as part of its text.
    expect(tiles).toHaveTextContent("하루 새 카드약 120장");
    // 120 today, the other 30 the day after.
    expect(tiles).toHaveTextContent("새 카드 모두 시작1일 뒤");
    // No presets and no custom mode.
    expect(dialog.queryByRole("button", { name: "10분" })).not.toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "직접 정하기" })).not.toBeInTheDocument();

    await user.click(number(20));
    expect(input()).toHaveFocus();
    expect(input()).toHaveAttribute("inputmode", "numeric");
    await user.clear(input());
    await user.type(input(), "10");
    // The tiles follow the number before it is committed: 60 today, 60 the next day and 30 after.
    expect(tiles).toHaveTextContent("약 60장");
    expect(tiles).toHaveTextContent("2일 뒤");

    await user.clear(input());
    await user.type(input(), "200");
    expect(dialog.getByText("5분에서 180분 사이로 입력해 주세요")).toBeInTheDocument();
    expect(input()).toHaveAttribute("aria-invalid", "true");
    expect(dialog.getByRole("button", { name: "저장" })).toBeDisabled();
    // Enter keeps a number out of the bounds in the field until it is fixed.
    await user.keyboard("{Enter}");
    expect(input()).toHaveFocus();
    // Control: the tiles keep the minutes chosen while the number is out of the bounds.
    expect(tiles).toHaveTextContent("약 120장");

    // An empty field keeps the minutes before.
    await user.clear(input());
    await user.keyboard("{Enter}");
    expect(number(20)).toHaveFocus();
    expect(dialog.queryByText("5분에서 180분 사이로 입력해 주세요")).not.toBeInTheDocument();
    // Nothing is stored until 저장.
    expect(postgrest.studySettings.has(testUser.id)).toBe(false);

    await user.click(number(20));
    await user.clear(input());
    await user.type(input(), "5{Enter}");
    expect(number(5)).toHaveFocus();
    expect(tiles).toHaveTextContent("약 30장");
    // Five is the floor.
    expect(dialog.getByRole("button", { name: "5분 줄이기" })).toBeDisabled();

    await user.click(dialog.getByRole("button", { name: "저장" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(postgrest.studySettings.get(testUser.id)?.daily_minutes).toBe(5);
    expect(testRouter.refresh).toHaveBeenCalledOnce();
    expect(control(20)).toHaveFocus();

    // The pages read again count today with the minutes saved.
    cleanup();
    await render(Profile, {});
    expect(control(5)).toHaveTextContent("5분");
    cleanup();
    await render(Today, {});
    expect(document.getElementById("hero-title")).toHaveTextContent("오늘 30장");
    expect(document.getElementById("hero-time")).toHaveTextContent("약 5분");
  });

  it("keep the number and its unit on one line, shrunk between the steps only where wider", async () => {
    seedNew(3);
    await render(Profile, {});
    const user = userEvent.setup();
    // "20분" is 60 px: a 30 px place shrinks it, a 60 px one holds it.
    for (const [place, zoom] of [
      [30, 0.5],
      [60, 1],
    ] as const) {
      const restore = layOutLines(place);
      const { dialog, number } = await openDialog(user);
      expect(zoomOf(within(number(20)).getByText("20")), `in a ${String(place)} px place`).toBe(
        zoom,
      );
      await user.click(dialog.getByRole("button", { name: "닫기" }));
      restore();
    }
  });

  it("commit a typed number when the field is left, as Enter does", async () => {
    seedNew(150);
    await render(Profile, {});
    const user = userEvent.setup();
    const { dialog, tiles, number, input } = await openDialog(user);

    await user.click(number(20));
    await user.clear(input());
    await user.type(input(), "37");
    await user.tab();
    expect(number(37)).toBeInTheDocument();
    expect(dialog.queryByRole("textbox")).not.toBeInTheDocument();
    // 37 minutes at 10 s: 222 a day, more than the 150 left.
    expect(tiles).toHaveTextContent("약 150장");
    expect(tiles).toHaveTextContent("오늘");
  });

  it("move the minutes by 5 within 5 to 180, and hand the focus to the other step when one disables under it", async () => {
    seedNew(150);
    await render(Profile, {});
    const user = userEvent.setup();
    const { dialog, number, input } = await openDialog(user);
    const less = dialog.getByRole("button", { name: "5분 줄이기" });
    const more = dialog.getByRole("button", { name: "5분 늘리기" });

    await user.click(more);
    expect(number(25)).toBeInTheDocument();
    await user.click(less);
    await user.click(less);
    expect(number(15)).toBeInTheDocument();

    await user.click(number(15));
    await user.clear(input());
    await user.type(input(), "175{Enter}");
    more.focus();
    await user.keyboard("{Enter}");
    expect(number(180)).toBeInTheDocument();
    expect(more).toBeDisabled();
    expect(less).toHaveFocus();
    // Control: a step that does not reach a bound keeps the focus.
    await user.keyboard("{Enter}");
    expect(number(175)).toBeInTheDocument();
    expect(less).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(number(170)).toBeInTheDocument();
    expect(less).toHaveFocus();

    // A step pressed without the focus, as a pointer does in some browsers, leaves the focus where it is.
    await user.click(number(170));
    await user.clear(input());
    await user.type(input(), "10{Enter}");
    expect(number(10)).toHaveFocus();
    fireEvent.click(less);
    expect(less).toBeDisabled();
    expect(number(5)).toHaveFocus();
  });

  it("give the control and every button of their dialog the shared hover and pressed state", async () => {
    seedNew(3);
    await render(Profile, {});
    expect(control(20)).toHaveClass("pressable");

    const { dialog } = await openDialog(userEvent.setup());
    for (const button of dialog.getAllByRole("button")) {
      expect(button).toHaveClass("pressable");
    }
  });

  it("close their dialog on Escape and on the close button, storing nothing", async () => {
    seedNew(3);
    await render(Profile, {});
    const user = userEvent.setup();

    await user.click(control(20));
    await user.click(screen.getByRole("button", { name: "5분 늘리기" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(control(20)).toHaveFocus();

    await user.click(control(20));
    await user.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(postgrest.studySettings.has(testUser.id)).toBe(false);
  });
});
