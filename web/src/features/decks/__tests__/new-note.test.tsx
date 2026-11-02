import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FakePostgrest } from "@/testing/mocks/postgrest";
import { server } from "@/testing/mocks/server";
import { setRequestCookies } from "@/testing/next-headers";
import { render } from "@/testing/render";
import { testRouter } from "@/testing/router";
import { signedInCookies } from "@/testing/session";

import { AuthoringButton } from "../components/authoring-button";

vi.mock("next/headers", () => import("@/testing/next-headers"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
let db: FakePostgrest;
beforeEach(async () => {
  db = new FakePostgrest();
  server.use(...db.handlers);
  setRequestCookies(await signedInCookies());
  testRouter.push.mockClear();
});

/** Opens 새 노트 from 홈's "새 노트" and names the note [name]. */
async function newNote(name: string) {
  await render(() => <AuthoringButton compact />, {});
  await userEvent.click(screen.getByRole("button", { name: "새 노트" }));
  const sheet = within(screen.getByRole("dialog", { name: "새 노트" }));
  await userEvent.type(sheet.getByRole("textbox", { name: "이름" }), name);
  return sheet;
}

describe("새 노트", () => {
  it("opens straight on its grouped name and 표지 색, offering the four note colours with the first chosen", async () => {
    const sheet = await newNote("토익");

    // No sheet of ways to start comes first: 새 노트 is the note's own screen.
    expect(sheet.queryByRole("button", { name: "직접 입력" })).not.toBeInTheDocument();
    expect(sheet.getByRole("textbox", { name: "이름" }).closest("label")).toHaveClass(
      "rounded-group",
      "bg-surface",
    );
    const colors = within(sheet.getByRole("group", { name: "표지 색" }));
    expect(colors.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "파랑",
      "복숭아",
      "모래",
      "회색",
    ]);
    expect(colors.getByRole("radio", { name: "파랑" })).toBeChecked();
    expect(colors.getByRole("radio", { name: "파랑" }).closest("label")).toHaveClass(
      "bg-deck-blue",
    );
  });

  it("stores the colour chosen with the note and opens it on 저장", async () => {
    const sheet = await newNote("토익");
    await userEvent.click(sheet.getByRole("radio", { name: "모래" }));
    await userEvent.click(sheet.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(testRouter.push).toHaveBeenCalledOnce();
    });
    expect(db.rows.decks).toEqual([expect.objectContaining({ name: "토익", color: "sand" })]);
    const id = String(db.rows.decks[0]?.id);
    expect(testRouter.push).toHaveBeenCalledWith(`/decks/${id}`);
  });

  it("opens the note with its 카드 추가 sheet up on 저장하고 카드 추가", async () => {
    const sheet = await newNote("토익");
    await userEvent.click(sheet.getByRole("button", { name: "저장하고 카드 추가" }));

    await waitFor(() => {
      expect(testRouter.push).toHaveBeenCalledOnce();
    });
    const id = String(db.rows.decks[0]?.id);
    expect(testRouter.push).toHaveBeenCalledWith(`/decks/${id}?adding=1`);
    expect(db.rows.decks[0]).toMatchObject({ color: "blue" });
  });

  it("lays 저장 and 저장하고 카드 추가 out as a pair whose first is sized to its label", async () => {
    const sheet = await newNote("토익");
    const save = sheet.getByRole("button", { name: "저장" });
    const pair = save.parentElement;
    // jsdom lays nothing out, so the pair's columns are read from its classes; the e2e spec
    // measures the labels' lines at 390 px.
    expect(pair).toHaveClass("grid", "grid-cols-[auto_minmax(0,1fr)]");
    expect(pair).toContainElement(sheet.getByRole("button", { name: "저장하고 카드 추가" }));
  });
});
